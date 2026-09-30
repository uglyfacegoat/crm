import { constants } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, validateFileReference, verifyRestoredFile } from "./backup-integrity.mjs";

export async function withStorageSnapshot({ databaseUrl, storageRoot, objectStorage, stagingDirectory, copyTimeoutMs, stageObject = writeFile }, operation) {
  if (!Number.isSafeInteger(copyTimeoutMs) || copyTimeoutMs < 1000 || copyTimeoutMs > 120_000) {
    throw new Error("Backup snapshot copy timeout must be between 1000 and 120000 ms.");
  }
  await mkdir(stagingDirectory, { mode: 0o700 });
  const sql = postgres(databaseUrl, {
    max: 2,
    connect_timeout: 10,
    onnotice: () => {},
    connection: { application_name: "crm_backup_snapshot", lock_timeout: 5000, idle_in_transaction_session_timeout: 420_000 },
  });
  let keeper;
  let keeperTransactionOpen = false;
  let operationError;
  try {
    keeper = await sql.reserve();
    const snapshot = await sql.begin("isolation level repeatable read", async (transaction) => {
      // LOCK must precede every SELECT: the exported snapshot must include writers we waited for.
      await transaction`LOCK TABLE document_versions, document_template_versions, chat_message_attachments, chat_channel_avatars IN SHARE MODE`;
      const copyStartedAt = performance.now();
      await transaction.unsafe(`SET LOCAL idle_in_transaction_session_timeout = '${copyTimeoutMs}ms'`);
      const [exported] = await transaction`SELECT pg_export_snapshot() AS id, clock_timestamp() AS captured_at`;
      if (!/^[0-9a-f]+-[0-9a-f]+-[0-9]+$/i.test(exported.id)) throw new Error("Unexpected PostgreSQL snapshot identifier.");
      await keeper`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      keeperTransactionOpen = true;
      await keeper.unsafe(`SET TRANSACTION SNAPSHOT '${exported.id}'`);
      const [retained] = await keeper`SELECT pg_export_snapshot() AS id`;
      if (!/^[0-9a-f]+-[0-9a-f]+-[0-9]+$/i.test(retained.id)) throw new Error("Unexpected retained snapshot identifier.");

      const fileCounts = {};
      let fileBytes = 0;
      for (const table of BACKUP_FILE_TABLES) {
        fileCounts[table] = 0;
        for await (const references of transaction`SELECT organization_id, storage_key, size_bytes, sha256 FROM ${transaction(table)}`.cursor(100)) {
          for (const reference of references) {
            if (performance.now() - copyStartedAt > copyTimeoutMs) throw new Error("Backup file snapshot exceeded its copy time budget.");
            const expected = validateFileReference(reference);
            const destination = join(stagingDirectory, reference.storage_key);
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            if (objectStorage) {
              const bytes = await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024);
              try {
                await stageObject(destination, bytes, { flag: "wx", mode: 0o600 });
              } catch (error) {
                // A full staging volume may leave a truncated file behind. Never let a
                // later attempt mistake that file for a verified backup member.
                if (error?.code !== "EEXIST") await rm(destination, { force: true });
                throw error;
              }
            } else {
              await verifyRestoredFile(storageRoot, reference);
              await copyFile(join(storageRoot, reference.storage_key), destination, constants.COPYFILE_EXCL);
            }
            fileBytes += await verifyRestoredFile(stagingDirectory, reference);
            fileCounts[table] += 1;
          }
        }
      }
      if (performance.now() - copyStartedAt > copyTimeoutMs) throw new Error("Backup file snapshot exceeded its copy time budget.");
      return {
        snapshotId: retained.id,
        recoveryPointAt: exported.captured_at.toISOString(),
        snapshotFileCounts: fileCounts,
        snapshotFileBytes: fileBytes,
        fileLockDurationMs: Math.ceil(performance.now() - copyStartedAt),
      };
    });
    // File-reference writes resume here. The read-only keeper preserves the same MVCC snapshot for pg_dump.
    const result = await operation(snapshot);
    await keeper`COMMIT`;
    keeperTransactionOpen = false;
    return result;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    const cleanupErrors = [];
    try {
      if (keeperTransactionOpen) await keeper`ROLLBACK`;
    } catch (error) {
      cleanupErrors.push(error);
    }
    keeper?.release();
    try {
      await sql.end({ timeout: 5 });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) throw new AggregateError(
      operationError ? [operationError, ...cleanupErrors] : cleanupErrors,
      "Backup snapshot cleanup failed.",
    );
  }
}
