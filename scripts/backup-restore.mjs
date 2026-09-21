import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";
import { databaseProcessEnvironment } from "./backup-worker-config.mjs";
import { captureProcess, runProcess } from "./backup-process.mjs";
import { BACKUP_FILE_TABLES, validateDocumentArchive, verifyBackupManifest, verifyRestoredFiles } from "./backup-integrity.mjs";

const REQUIRED_TABLES = [
  "schema_migrations",
  "organizations",
  "organization_members",
  "clients",
  "orders",
  "documents",
  "service_visits",
  ...BACKUP_FILE_TABLES,
];

function restoredDatabaseUrl(databaseUrl, databaseName) {
  const restoredUrl = new URL(databaseUrl);
  restoredUrl.pathname = `/${databaseName}`;
  return restoredUrl.toString();
}

export async function verifyBackupRestore({ archiveDirectory, databaseUrl }) {
  const startedAt = performance.now();
  const archiveName = basename(archiveDirectory);
  if (!/^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(archiveName)) {
    throw new Error("Backup archive name is invalid.");
  }

  await verifyBackupManifest(archiveDirectory);
  const { processEnvironment } = databaseProcessEnvironment(databaseUrl);
  const documentArchivePath = join(archiveDirectory, "documents.tar.gz");
  const archiveEntries = await captureProcess("tar", ["-tzf", documentArchivePath], { environment: processEnvironment });
  const verboseEntries = await captureProcess("tar", ["-tvzf", documentArchivePath], { environment: processEnvironment });
  validateDocumentArchive(archiveEntries, verboseEntries);

  const extractionDirectory = await mkdtemp(join(tmpdir(), "crm-documents-restore-"));
  const temporaryDatabase = `crm_restore_check_${Date.now()}_${randomBytes(4).toString("hex")}`;
  let restoredSql;
  let databaseCreated = false;
  let restoreResult;
  let operationError;
  const cleanupErrors = [];
  try {
    await runProcess("tar", ["-xzf", documentArchivePath, "-C", extractionDirectory], { environment: processEnvironment });
    await runProcess("createdb", [temporaryDatabase], { environment: processEnvironment });
    databaseCreated = true;
    await runProcess("pg_restore", [
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      temporaryDatabase,
      join(archiveDirectory, "database.dump"),
    ], { environment: processEnvironment });

    restoredSql = postgres(restoredDatabaseUrl(databaseUrl, temporaryDatabase), {
      max: 1,
      connect_timeout: 10,
      onnotice: () => undefined,
    });
    const tableRows = await restoredSql`
      SELECT requested_table, to_regclass('public.' || requested_table) IS NOT NULL AS present
      FROM unnest(${REQUIRED_TABLES}::text[]) AS requested_table
    `;
    const missingTables = tableRows.filter((row) => row.present !== true).map((row) => row.requested_table);
    if (missingTables.length > 0) throw new Error(`Restored database is missing tables: ${missingTables.join(", ")}.`);
    const [migrationState] = await restoredSql`SELECT count(*)::integer AS count FROM schema_migrations`;
    if (!migrationState || migrationState.count < 1) throw new Error("Restored database has no applied migration history.");

    const fileVerification = await verifyRestoredFiles(restoredSql, extractionDirectory);
    restoreResult = { archiveName, migrationCount: migrationState.count, ...fileVerification };
  } catch (error) {
    operationError = error;
  } finally {
    if (restoredSql) {
      try {
        await restoredSql.end({ timeout: 5 });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (databaseCreated) {
      try {
        await runProcess("dropdb", ["--if-exists", "--force", temporaryDatabase], { environment: processEnvironment });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await rm(extractionDirectory, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (operationError || cleanupErrors.length) {
    throw new AggregateError([operationError, ...cleanupErrors].filter(Boolean), "Backup restore verification failed.");
  }
  return { ...restoreResult, restoreDurationMs: Math.ceil(performance.now() - startedAt) };
}
