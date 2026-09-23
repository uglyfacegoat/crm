import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, validateFileReference, verifyRestoredFile } from "./backup-integrity.mjs";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function realDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory()) throw new Error("Document storage path is not a real directory.");
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await handle.sync(); }
  finally { await handle.close(); }
}

async function ensureDestinationDirectories(root, key) {
  const parts = key.split("/");
  let parent = root;
  for (const part of parts.slice(0, 2)) {
    const child = join(parent, part);
    try { await mkdir(child, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    await realDirectory(child);
    await syncDirectory(parent);
    parent = child;
  }
  return parent;
}

async function readLocalVerified(root, reference) {
  const expected = validateFileReference(reference);
  await verifyRestoredFile(root, reference);
  const handle = await open(join(root, expected.storageKey),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== expected.sizeBytes) {
      throw new Error("Local source changed during transfer.");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== expected.sizeBytes || hash(bytes) !== expected.sha256
      || before.mtimeMs !== after.mtimeMs || before.size !== after.size) {
      throw new Error("Local source changed during transfer.");
    }
    return bytes;
  } finally { await handle.close(); }
}

async function writeLocalVerified(root, reference, bytes) {
  const expected = validateFileReference(reference);
  const directory = await ensureDestinationDirectories(root, expected.storageKey);
  const path = join(root, expected.storageKey);
  try {
    const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    finally { await handle.close(); }
    await syncDirectory(directory);
  } catch (error) { if (error.code !== "EEXIST") throw error; }
  await verifyRestoredFile(root, reference);
}

async function writeS3Verified(objectStorage, reference, bytes) {
  const expected = validateFileReference(reference);
  try {
    await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024);
    return;
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Existing S3 object is unavailable or conflicts with the source.", { cause: error });
  }
  try { await objectStorage.write(expected.storageKey, bytes); }
  catch (error) {
    // A lost PUT response or concurrent conditional write is resolved only by verified bytes.
    try { await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024); }
    catch { throw error; }
  }
  await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024);
}

async function referenceSnapshot(connection) {
  const references = [];
  const counts = {};
  const unique = new Map();
  for (const table of BACKUP_FILE_TABLES) {
    const rows = await connection`SELECT organization_id, storage_key, size_bytes, sha256
      FROM ${connection(table)} ORDER BY organization_id, storage_key`;
    counts[table] = rows.length;
    for (const row of rows) {
      const expected = validateFileReference(row);
      references.push({ table, organizationId: row.organization_id,
        storageKey: expected.storageKey, sizeBytes: expected.sizeBytes, sha256: expected.sha256 });
      const prior = unique.get(expected.storageKey);
      if (prior && (prior.sizeBytes !== expected.sizeBytes || prior.sha256 !== expected.sha256)) {
        throw new Error("Committed references disagree on a storage key's bytes.");
      }
      unique.set(expected.storageKey, { organization_id: row.organization_id,
        storage_key: expected.storageKey, size_bytes: expected.sizeBytes, sha256: expected.sha256 });
    }
  }
  references.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const items = [...unique.values()].sort((a, b) => a.storage_key.localeCompare(b.storage_key));
  const totalBytes = items.reduce((sum, item) => sum + item.size_bytes, 0);
  if (!Number.isSafeInteger(totalBytes) || items.length > 2_147_483_647) throw new Error("Transfer inventory exceeds supported bounds.");
  return { referenceSha256: hash(JSON.stringify(references)), counts, items, totalBytes };
}

async function inventoryReferences(auditStorage, keys) {
  const versioning = await auditStorage.versioning();
  const wanted = new Set(keys);
  const versions = new Map(keys.map((key) => [key, []]));
  for await (const item of auditStorage.inventory()) {
    if (wanted.has(item.storageKey)) versions.get(item.storageKey).push(item);
  }
  if (await auditStorage.versioning() !== versioning) {
    throw new Error("S3 bucket versioning changed during transfer inventory.");
  }
  return { versioning, versions };
}

function assertSingleCurrentVersion(items, key, required) {
  if ((required && items.length !== 1) || items.length > 1
    || (items.length === 1 && (items[0].kind !== "object" || !items[0].isLatest))) {
    throw new Error(`S3 key ${key} has missing or unexpected object versions.`);
  }
}

export async function transferDocumentStorage({ databaseUrl, storageRoot, objectStorage, auditStorage,
  transferId, direction, caseId, actor, onStage = () => {} }) {
  if (!databaseUrl || !isAbsolute(storageRoot ?? "") || resolve(storageRoot) === "/"
    || !objectStorage || !auditStorage || !UUID.test(transferId ?? "")
    || !["local_to_s3", "s3_to_local"].includes(direction)
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120) {
    throw new Error("Valid database, storage, S3 target, transfer ID, direction, case and actor are required.");
  }
  const root = resolve(storageRoot);
  await realDirectory(root);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_storage_transfer" } });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        const [control] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
        if (control?.accepting !== false) throw new Error("Pause file writes before transfer.");
        const [{ pending }] = await connection`SELECT count(*)::integer AS pending FROM file_write_operations`;
        if (pending) throw new Error("Resolve interrupted file writes before transfer.");
        const snapshot = await referenceSnapshot(connection);
        const beforeInventory = await inventoryReferences(auditStorage,
          snapshot.items.map((item) => item.storage_key));
        for (const item of snapshot.items) {
          assertSingleCurrentVersion(beforeInventory.versions.get(item.storage_key),
            item.storage_key, direction === "s3_to_local");
        }
        let [session] = await connection`SELECT direction, case_id, actor, reference_sha256,
          reference_counts, file_count, total_bytes, state
          FROM file_storage_transfers WHERE id = ${transferId}::uuid`;
        if (session) {
          if (session.direction !== direction || session.case_id !== caseId || session.actor !== actor.trim()
            || session.reference_sha256 !== snapshot.referenceSha256
            || Number(session.file_count) !== snapshot.items.length
            || Number(session.total_bytes) !== snapshot.totalBytes
            || !isDeepStrictEqual(session.reference_counts, snapshot.counts)) {
            throw new Error("Transfer retry does not match its prepared reference inventory.");
          }
        } else {
          const [other] = await connection`SELECT id FROM file_storage_transfers WHERE state = 'prepared' LIMIT 1`;
          if (other) throw new Error("Finish the existing storage transfer before starting another.");
          await connection`BEGIN`;
          try {
            await connection`INSERT INTO file_storage_transfers
              (id, direction, case_id, actor, database_role, reference_sha256,
                reference_counts, file_count, total_bytes, state)
              VALUES (${transferId}, ${direction}, ${caseId}, ${actor.trim()}, current_user,
                ${snapshot.referenceSha256}, ${connection.json(snapshot.counts)},
                ${snapshot.items.length}, ${snapshot.totalBytes}, 'prepared')`;
            for (const item of snapshot.items) {
              await connection`INSERT INTO file_storage_transfer_items
                (transfer_id, storage_key, size_bytes, sha256, state)
                VALUES (${transferId}, ${item.storage_key}, ${item.size_bytes}, ${item.sha256}, 'pending')`;
            }
            await connection`COMMIT`;
          } catch (error) { await connection`ROLLBACK`; throw error; }
          session = { state: "prepared" };
          onStage("prepared");
        }
        const rows = await connection`SELECT storage_key, size_bytes, sha256, state
          FROM file_storage_transfer_items WHERE transfer_id = ${transferId}::uuid ORDER BY storage_key`;
        if (rows.length !== snapshot.items.length) throw new Error("Transfer journal has missing items.");
        if (session.state === "complete" && rows.some((row) => row.state !== "complete")) {
          throw new Error("Completed transfer has unfinished item rows.");
        }
        let completed = 0;
        for (const [index, reference] of snapshot.items.entries()) {
          const row = rows[index];
          if (row.storage_key !== reference.storage_key || Number(row.size_bytes) !== reference.size_bytes
            || row.sha256 !== reference.sha256) throw new Error("Transfer journal differs from references.");
          const expected = validateFileReference(reference);
          const bytes = direction === "local_to_s3"
            ? await readLocalVerified(root, reference)
            : await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024);
          if (direction === "local_to_s3") await writeS3Verified(objectStorage, reference, bytes);
          else await writeLocalVerified(root, reference, bytes);
          onStage("copied", expected.storageKey);
          if (row.state === "pending") {
            await connection`UPDATE file_storage_transfer_items SET state = 'complete', completed_at = now()
              WHERE transfer_id = ${transferId}::uuid AND storage_key = ${expected.storageKey}`;
          }
          completed += 1;
        }
        if ((await referenceSnapshot(connection)).referenceSha256 !== snapshot.referenceSha256) {
          throw new Error("Committed file references changed during transfer.");
        }
        const afterInventory = await inventoryReferences(auditStorage,
          snapshot.items.map((item) => item.storage_key));
        if (afterInventory.versioning !== beforeInventory.versioning) {
          throw new Error("S3 bucket versioning changed during transfer.");
        }
        for (const item of snapshot.items) {
          const before = beforeInventory.versions.get(item.storage_key);
          const after = afterInventory.versions.get(item.storage_key);
          assertSingleCurrentVersion(after, item.storage_key, true);
          if (after[0].sizeBytes !== item.size_bytes
            || (before.length && (before[0].versionId !== after[0].versionId
              || before[0].modifiedAt !== after[0].modifiedAt))) {
            throw new Error("S3 object version changed during transfer.");
          }
        }
        const [{ remaining }] = await connection`SELECT count(*)::integer AS remaining
          FROM file_storage_transfer_items WHERE transfer_id = ${transferId}::uuid AND state <> 'complete'`;
        if (remaining) throw new Error("Transfer journal still has incomplete items.");
        if (session.state === "prepared") {
          onStage("before_complete");
          await connection`UPDATE file_storage_transfers SET state = 'complete', completed_at = now()
            WHERE id = ${transferId}::uuid`;
        }
        return { transferId, direction, caseId, referenceSha256: snapshot.referenceSha256,
          referenceCounts: snapshot.counts, fileCount: snapshot.items.length,
          totalBytes: snapshot.totalBytes, completed, alreadyComplete: session.state === "complete" };
      } finally { await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`; }
    } finally { connection.release(); }
  } finally { await sql.end(); }
}

export async function inspectStorageTransfer({ databaseUrl, transferId }) {
  if (!databaseUrl || !UUID.test(transferId ?? "")) {
    throw new Error("A database URL and valid transfer ID are required.");
  }
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_storage_transfer_inspect", default_transaction_read_only: "on" } });
  try {
    const [session] = await sql`SELECT id, direction, case_id, reference_sha256,
      reference_counts, file_count, total_bytes, state, prepared_at, completed_at
      FROM file_storage_transfers WHERE id = ${transferId}::uuid`;
    if (!session) throw new Error("Storage transfer was not found.");
    const [progress] = await sql`SELECT count(*) FILTER (WHERE state = 'complete')::integer AS completed_files,
      coalesce(sum(size_bytes) FILTER (WHERE state = 'complete'), 0)::bigint AS completed_bytes,
      count(*) FILTER (WHERE state = 'pending')::integer AS pending_files
      FROM file_storage_transfer_items WHERE transfer_id = ${transferId}::uuid`;
    const [next] = await sql`SELECT storage_key FROM file_storage_transfer_items
      WHERE transfer_id = ${transferId}::uuid AND state = 'pending' ORDER BY storage_key LIMIT 1`;
    return { transferId: session.id, direction: session.direction, caseId: session.case_id,
      referenceSha256: session.reference_sha256, referenceCounts: session.reference_counts,
      fileCount: session.file_count, totalBytes: Number(session.total_bytes), state: session.state,
      preparedAt: session.prepared_at, completedAt: session.completed_at,
      completedFiles: progress.completed_files, completedBytes: Number(progress.completed_bytes),
      pendingFiles: progress.pending_files, nextPendingKey: next?.storage_key ?? null };
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let objectStorage;
  let auditStorage;
  try {
    const [direction, transferId, caseId, ...actorWords] = process.argv.slice(2);
    if (direction === "inspect") {
      if (process.argv.length !== 4) throw new Error("Use inspect <transfer-id>.");
      console.log(JSON.stringify(await inspectStorageTransfer({ databaseUrl: process.env.DATABASE_URL, transferId })));
      process.exit(0);
    }
    if (process.argv.length < 6) throw new Error("Use <local_to_s3|s3_to_local> <transfer-id> <case-id> <operator-name>.");
    objectStorage = createS3Storage(process.env);
    auditStorage = createS3AuditStorage(process.env);
    const result = await transferDocumentStorage({ databaseUrl: process.env.DATABASE_URL,
      storageRoot: process.env.DOCUMENT_STORAGE_ROOT, objectStorage, auditStorage,
      direction, transferId, caseId, actor: actorWords.join(" ") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "storage.transfer_failed",
      code: error.code ?? "STORAGE_TRANSFER_FAILED", message: error.message }));
    process.exitCode = 1;
  } finally { objectStorage?.close(); auditStorage?.close(); }
}
