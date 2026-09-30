import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { verifyBackupRestore } from "./backup-restore.mjs";

try {
  const databaseUrl = process.env.DATABASE_URL;
  const backupRoot = resolve(process.env.BACKUP_ROOT ?? "/app/backups");
  if (!databaseUrl) throw new Error("DATABASE_URL is required to verify a backup.");

  const requestedArchive = process.argv.find((argument) => argument.startsWith("--archive="))?.slice("--archive=".length);
  const archiveNames = (await readdir(backupRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const archiveName = requestedArchive ?? archiveNames[0];
  if (!archiveName || !archiveNames.includes(archiveName)) throw new Error("Requested backup archive does not exist.");

  const result = await verifyBackupRestore({ archiveDirectory: join(backupRoot, archiveName), databaseUrl });
  if (!process.argv.includes("--verify-only")) {
    const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => undefined });
    try {
      await sql`
        UPDATE backup_runs SET restore_verified_at = now()
        WHERE archive_name = ${archiveName} AND status = 'succeeded'
      `;
    } finally {
      await sql.end();
    }
  }
  console.log(JSON.stringify({ operation: "backup.restore_check", status: "succeeded", ...result }));
} catch (error) {
  console.error(JSON.stringify({ operation: "backup.restore_check", status: "failed",
    errorCode: safeCliErrorCode(error, "BACKUP_RESTORE_CHECK_FAILED") }));
  process.exitCode = 1;
}
