import { randomBytes } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import postgres from "postgres";
import {
  backupWorkerHealthWindow,
  databaseProcessEnvironment,
} from "./backup-worker-config.mjs";
import { runProcess, sha256File } from "./backup-process.mjs";
import { exportArchive } from "./backup-export.mjs";
import { removeExpiredArchives } from "./backup-retention.mjs";
import { verifyBackupRestore } from "./backup-restore.mjs";
import { withStorageSnapshot } from "./backup-snapshot.mjs";
import { validateBackupWorkerEnvironment } from "./worker-runtime-config.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";

const JOB_NAME = "system.backup";
const { databaseUrl, config, backend, storageRoot, backupRoot, backupExportRoot } = validateBackupWorkerEnvironment(process.env);
const objectStorage = backend === "s3" ? createS3Storage(process.env) : undefined;

const sql = postgres(databaseUrl, {
  max: 2,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => undefined,
});

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function isPathInside(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent !== "" && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== "..";
}

async function prepareDirectories() {
  if (storageRoot === backupRoot || isPathInside(storageRoot, backupRoot) || isPathInside(backupRoot, storageRoot)) {
    throw new Error("Backup and document storage directories must not contain each other.");
  }
  if (!objectStorage) await stat(storageRoot);
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  if (backupExportRoot) {
    if (backupExportRoot === backupRoot || backupExportRoot === storageRoot || isPathInside(backupRoot, backupExportRoot) || isPathInside(backupExportRoot, backupRoot) || isPathInside(storageRoot, backupExportRoot) || isPathInside(backupExportRoot, storageRoot)) {
      throw new Error("Backup export, protected backup, and document storage directories must be separate.");
    }
    await mkdir(backupExportRoot, { recursive: true, mode: 0o700 });
  }
}

async function createArchive(runId) {
  const now = new Date();
  const archiveName = `${compactTimestamp(now)}-${randomBytes(4).toString("hex")}`;
  const partialDirectory = join(backupRoot, `.partial-${archiveName}`);
  const archiveDirectory = join(backupRoot, archiveName);
  await mkdir(partialDirectory, { mode: 0o700 });

  try {
    const databaseDumpPath = join(partialDirectory, "database.dump");
    const documentsArchivePath = join(partialDirectory, "documents.tar.gz");
    const { databaseName, processEnvironment } = databaseProcessEnvironment(databaseUrl);
    const stagingDirectory = join(partialDirectory, "documents");
    const snapshot = await withStorageSnapshot({
      databaseUrl, storageRoot, objectStorage, stagingDirectory, copyTimeoutMs: config.snapshotCopyTimeoutMs,
    }, async (snapshot) => {
      await runProcess("pg_dump", [
        "--format=custom", "--no-owner", "--no-privileges",
        `--snapshot=${snapshot.snapshotId}`, "--file", databaseDumpPath, databaseName,
      ], { environment: processEnvironment, timeoutMs: 240_000 });
      return snapshot;
    });
    await runProcess("tar", ["-czf", documentsArchivePath, "-C", stagingDirectory, "."], { environment: processEnvironment });
    await rm(stagingDirectory, { recursive: true });

    const [databaseFile, documentsFile, databaseSha256, documentsSha256] = await Promise.all([
      stat(databaseDumpPath),
      stat(documentsArchivePath),
      sha256File(databaseDumpPath),
      sha256File(documentsArchivePath),
    ]);
    const metadataPath = join(partialDirectory, "metadata.json");
    await writeFile(metadataPath, `${JSON.stringify({
      formatVersion: 2,
      archiveName,
      createdAt: now.toISOString(),
      databaseName,
      consistency: "postgres-exported-snapshot",
      ...snapshot,
    }, null, 2)}\n`, { mode: 0o600 });
    const metadataSha256 = await sha256File(metadataPath);
    await writeFile(join(partialDirectory, "manifest.sha256"), [
      `${databaseSha256}  database.dump`,
      `${documentsSha256}  documents.tar.gz`,
      `${metadataSha256}  metadata.json`,
      "",
    ].join("\n"), { mode: 0o600 });

    await rename(partialDirectory, archiveDirectory);
    await sql`
      UPDATE backup_runs SET
        archive_name = ${archiveName},
        database_bytes = ${databaseFile.size},
        documents_bytes = ${documentsFile.size},
        database_sha256 = ${databaseSha256},
        documents_sha256 = ${documentsSha256}
      WHERE id = ${runId} AND status = 'running'
    `;
    return {
      archiveName,
      archiveDirectory,
      databaseBytes: databaseFile.size,
      documentsBytes: documentsFile.size,
      ...snapshot,
    };
  } catch (error) {
    await rm(partialDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function markJobFailure(runId, error) {
  const failureCode = error instanceof Error && error.name !== "Error" ? error.name.slice(0, 120) : "backup_execution_failed";
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE backup_runs SET status = 'failed', completed_at = now(), failure_code = ${failureCode}
      WHERE id = ${runId} AND status = 'running'
    `;
    await transaction`
      UPDATE background_job_status SET
        status = 'failed',
        heartbeat_at = now(),
        last_failed_at = now(),
        last_error_code = ${failureCode},
        updated_at = now()
      WHERE job_name = ${JOB_NAME}
    `;
  });
  console.error(JSON.stringify({ operation: "backup_worker.run", status: "failed", runId, failureCode }));
}

async function executeBackup() {
  const [run] = await sql`INSERT INTO backup_runs (status) VALUES ('running') RETURNING id`;
  try {
    await sql`
      INSERT INTO background_job_status (job_name, status, heartbeat_at, last_started_at)
      VALUES (${JOB_NAME}, 'running', now(), now())
      ON CONFLICT (job_name) DO UPDATE SET
        status = 'running',
        heartbeat_at = now(),
        last_started_at = now(),
        last_error_code = NULL,
        updated_at = now()
    `;
    const archive = await createArchive(run.id);
    const restoreResult = await verifyBackupRestore({ archiveDirectory: archive.archiveDirectory, databaseUrl });
    const hostExportedAt = await exportArchive({ backupExportRoot, archiveName: archive.archiveName,
      archiveDirectory: archive.archiveDirectory });
    const result = {
      archiveName: archive.archiveName,
      databaseBytes: archive.databaseBytes,
      documentsBytes: archive.documentsBytes,
      restoreVerified: true,
      migrationCount: restoreResult.migrationCount,
      verifiedFileCounts: restoreResult.verifiedFileCounts,
      verifiedFileBytes: restoreResult.verifiedFileBytes,
      restoreDurationMs: restoreResult.restoreDurationMs,
      recoveryPointAt: archive.recoveryPointAt,
      fileLockDurationMs: archive.fileLockDurationMs,
      snapshotCopyTimeoutMs: config.snapshotCopyTimeoutMs,
      backupIntervalMs: config.backupIntervalMs,
      retryIntervalMs: config.retryIntervalMs,
      retentionDays: config.retentionDays,
      hostExportEnabled: backupExportRoot !== null,
      hostExportedAt,
    };
    const completedAt = new Date();
    const [lastAccepted] = await sql`
      SELECT archive_name FROM backup_runs
      WHERE status = 'succeeded' AND restore_verified_at IS NOT NULL AND archive_name IS NOT NULL
      ORDER BY completed_at DESC LIMIT 1
    `;
    const protectedArchiveNames = [lastAccepted?.archive_name, archive.archiveName];
    await removeExpiredArchives(backupRoot, completedAt, config.retentionDays, protectedArchiveNames);
    if (backupExportRoot) {
      await removeExpiredArchives(backupExportRoot, completedAt, config.retentionDays, protectedArchiveNames);
    }
    await sql.begin(async (transaction) => {
      await transaction`
        UPDATE backup_runs SET status = 'succeeded', completed_at = now(), restore_verified_at = now()
        WHERE id = ${run.id} AND status = 'running'
      `;
      await transaction`
        UPDATE background_job_status SET
          status = 'succeeded',
          heartbeat_at = now(),
          last_succeeded_at = now(),
          last_error_code = NULL,
          last_result = ${transaction.json(result)},
          updated_at = now()
        WHERE job_name = ${JOB_NAME}
      `;
    });
    console.log(JSON.stringify({ operation: "backup_worker.run", status: "succeeded", runId: run.id, ...result }));
    return true;
  } catch (error) {
    await markJobFailure(run.id, error);
    return false;
  }
}

async function isBackupDue() {
  const [status] = await sql`
    SELECT status, last_started_at, last_succeeded_at
    FROM background_job_status
    WHERE job_name = ${JOB_NAME}
  `;
  if (!status) return true;
  const now = Date.now();
  if (status.status === "failed") {
    return now - new Date(status.last_started_at).getTime() >= config.retryIntervalMs;
  }
  if (!status.last_succeeded_at) return true;
  return now - new Date(status.last_succeeded_at).getTime() >= config.backupIntervalMs;
}

async function runCycle() {
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [lockResult] = await connection`SELECT pg_try_advisory_lock(hashtext(${JOB_NAME})) AS locked`;
    locked = lockResult?.locked === true;
    if (!locked) return;
    if (await isBackupDue()) {
      return await executeBackup();
    } else {
      await connection`
        UPDATE background_job_status SET heartbeat_at = now(), updated_at = now()
        WHERE job_name = ${JOB_NAME}
      `;
    }
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(hashtext(${JOB_NAME}))`;
    connection.release();
  }
}

async function checkHealth() {
  const healthWindowMs = backupWorkerHealthWindow(config.pollIntervalMs);
  const [status] = await sql`
    SELECT heartbeat_at > now() - (${healthWindowMs}::bigint * interval '1 millisecond') AS healthy
    FROM background_job_status
    WHERE job_name = ${JOB_NAME}
  `;
  if (status?.healthy !== true) process.exitCode = 1;
}

async function main() {
  await prepareDirectories();
  if (process.argv.includes("--healthcheck")) {
    try {
      await checkHealth();
    } finally {
      await sql.end();
    }
    return;
  }
  if (process.argv.includes("--run-once")) {
    try {
      if (await runCycle() === false) process.exitCode = 1;
    } finally {
      await sql.end();
    }
    return;
  }

  let stopping = false;
  let wakeTimer;
  let wakeWorker;
  const stop = () => {
    stopping = true;
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeWorker?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    await runCycle();
    if (stopping) break;
    await new Promise((resolveWait) => {
      wakeWorker = resolveWait;
      wakeTimer = setTimeout(resolveWait, config.pollIntervalMs);
    });
    wakeTimer = undefined;
    wakeWorker = undefined;
  }
  await sql.end({ timeout: 5 });
}

await main();
