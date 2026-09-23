import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, STORAGE_KEY, verifyRestoredFile } from "./backup-integrity.mjs";
import { verifyQuarantineCopy } from "./file-write-quarantine.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

async function checkRoot(storageRoot) {
  if (!storageRoot || !isAbsolute(storageRoot) || resolve(storageRoot) === "/") throw new Error("An explicit local storage root is required.");
  if (!(await lstat(storageRoot)).isDirectory()) throw new Error("Storage root must be a real directory.");
}

async function unreferencedFileState(storageRoot, key) {
  const segments = key.split("/");
  for (let length = 1; length <= segments.length; length += 1) {
    let stat;
    try { stat = await lstat(join(storageRoot, ...segments.slice(0, length))); }
    catch (error) {
      if (error.code === "ENOENT") return "absent_unreferenced";
      throw error;
    }
    if (length < segments.length && !stat.isDirectory()) return "unexpected_path";
    if (length === segments.length) return stat.isFile() && stat.nlink === 1 ? "unreferenced_present" : "unexpected_path";
  }
  throw new Error("Invalid storage key.");
}

async function inspectOperation(connection, operation, storageRoot, objectStorage, quarantineRoot) {
  const entries = [];
  const objectVersions = new Map();
  let bucketVersioning = null;
  if (objectStorage) {
    bucketVersioning = await objectStorage.versioning();
    const keys = new Set(operation.storage_keys);
    for await (const item of objectStorage.inventory()) {
      if (keys.has(item.storageKey)) {
        const versions = objectVersions.get(item.storageKey) ?? [];
        versions.push({ versionId: item.versionId, kind: item.kind, isLatest: item.isLatest, sizeBytes: item.sizeBytes });
        objectVersions.set(item.storageKey, versions);
      }
    }
    if (await objectStorage.versioning() !== bucketVersioning) throw new Error("Bucket versioning changed during recovery review.");
  }
  for (const key of operation.storage_keys) {
    if (!STORAGE_KEY.test(key)) throw new Error("An operation contains an invalid storage key.");
    const versions = objectVersions.get(key) ?? [];
    versions.sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const versionEvidence = objectStorage ? { versionCount: versions.length,
      versionSha256: createHash("sha256").update(JSON.stringify(versions)).digest("hex") } : {};
    const organizationId = key.split("/")[0];
    const references = [];
    for (const table of BACKUP_FILE_TABLES) {
      const rows = await connection`SELECT organization_id, storage_key, size_bytes, sha256 FROM ${connection(table)}
        WHERE organization_id = ${organizationId}::uuid AND storage_key = ${key}`;
      for (const row of rows) references.push({ table, row });
    }
    if (!references.length) {
      let state = objectStorage
        ? objectVersions.has(key) ? "unreferenced_present" : "absent_unreferenced"
        : await unreferencedFileState(storageRoot, key);
      let quarantine = null;
      if (!objectStorage) {
        const [record] = await connection`SELECT quarantine_path, size_bytes, sha256, case_id, state
          FROM file_write_quarantine WHERE operation_id = ${operation.id} AND storage_key = ${key}`;
        if (record) {
          quarantine = { path: record.quarantine_path, sizeBytes: Number(record.size_bytes),
            sha256: record.sha256, caseId: record.case_id, state: record.state };
          if (state === "absent_unreferenced") {
            try {
              await verifyQuarantineCopy(quarantineRoot, operation.id, key, record);
              state = "quarantined_verified";
            } catch { state = "quarantine_invalid"; }
          }
        }
      }
      entries.push({ key, state, references: [], quarantine, ...versionEvidence });
      continue;
    }
    // Generated keys are write-once. A second version or delete marker can
    // represent an interrupted write even when the current bytes match a row.
    let valid = !objectStorage || (versions.length === 1 && versions[0].kind === "object" && versions[0].isLatest);
    for (const { row } of references) {
      try {
        if (objectStorage) await objectStorage.readVerified(key,
          { sizeBytes: Number(row.size_bytes), sha256: row.sha256 }, 15 * 1024 * 1024);
        else await verifyRestoredFile(storageRoot, row);
      }
      catch { valid = false; }
    }
    entries.push({ key, state: valid ? "referenced_verified" : "reference_invalid",
      references: references.map(({ table, row }) => ({ table, sizeBytes: Number(row.size_bytes), sha256: row.sha256 })),
      ...versionEvidence });
  }
  return { entries, bucketVersioning };
}

export async function reviewOrResolveFileWrite({ databaseUrl, storageRoot, objectStorage, quarantineRoot,
  operationId, reviewSha256, evidenceSha256, caseId, actor }) {
  if (!databaseUrl || !UUID.test(operationId ?? "")) throw new Error("DATABASE_URL and a valid operation ID are required.");
  const resolving = reviewSha256 !== undefined;
  if (resolving && (!SHA256.test(reviewSha256) || !SHA256.test(evidenceSha256 ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120)) {
    throw new Error("Resolution needs a review hash, evidence hash, case ID and actor.");
  }
  if (!objectStorage) await checkRoot(storageRoot);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_recovery" } });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      await connection`SET idle_in_transaction_session_timeout = '600000ms'`;
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        await connection.unsafe(resolving ? "BEGIN ISOLATION LEVEL REPEATABLE READ" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
          const [control] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
          if (control?.accepting !== false) throw new Error("Pause file writes before recovery review.");
          const [operation] = await connection`SELECT id, started_at, storage_keys FROM file_write_operations
            WHERE id = ${operationId}::uuid`;
          if (!operation) {
            const [resolved] = await connection`SELECT review_sha256, evidence_sha256, case_id, actor
              FROM file_write_resolutions WHERE operation_id = ${operationId}::uuid`;
            if (resolving && resolved?.review_sha256 === reviewSha256 && resolved.evidence_sha256 === evidenceSha256
              && resolved.case_id === caseId && resolved.actor === actor.trim()) {
              await connection`COMMIT`;
              return { operationId, reviewSha256, resolved: true, alreadyResolved: true };
            }
            throw new Error("File write operation was not found or was resolved with different evidence.");
          }
          const { entries, bucketVersioning } = await inspectOperation(connection, operation, storageRoot, objectStorage, quarantineRoot);
          const review = { operationId: operation.id, startedAt: operation.started_at.toISOString(),
            backend: objectStorage ? "s3" : "local", bucketVersioning, storageKeys: operation.storage_keys, entries };
          const hash = createHash("sha256").update(JSON.stringify(review)).digest("hex");
          const eligible = entries.every(({ state }) => ["referenced_verified", "absent_unreferenced", "quarantined_verified"].includes(state));
          if (resolving) {
            if (hash !== reviewSha256) throw new Error("Recovery review changed; inspect the operation again.");
            if (!eligible) throw new Error("Unreferenced or invalid files require separate preservation and review.");
            if (entries.some(({ quarantine }) => quarantine && quarantine.caseId !== caseId)) {
              throw new Error("Resolution case ID differs from its quarantine record.");
            }
            await connection`INSERT INTO file_write_resolutions
              (operation_id, started_at, storage_keys, review, review_sha256, evidence_sha256, case_id, actor, database_role)
              VALUES (${operation.id}, ${operation.started_at}, ${operation.storage_keys}, ${connection.json(review)},
                ${hash}, ${evidenceSha256}, ${caseId}, ${actor.trim()}, current_user)`;
            const removed = await connection`DELETE FROM file_write_operations WHERE id = ${operation.id} RETURNING id`;
            if (removed.length !== 1) throw new Error("Operation changed during resolution.");
          }
          await connection`COMMIT`;
          return { ...review, reviewSha256: hash, eligibleForManualResolution: eligible, resolved: resolving };
        } catch (error) {
          await connection`ROLLBACK`;
          throw error;
        }
      } finally {
        await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      }
    } finally { connection.release(); }
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const backend = storageBackend(process.env);
    const [mode, operationId, reviewSha256, caseId, evidencePath, ...actorWords] = process.argv.slice(2);
    if (mode !== "review" && mode !== "resolve") throw new Error("Use review or resolve.");
    if (mode === "review" && process.argv.length !== 4) throw new Error("Use review <operation-id>.");
    let evidenceSha256;
    if (mode === "resolve") {
      if (!isAbsolute(evidencePath ?? "") || resolve(evidencePath).startsWith(`${resolve(process.env.DOCUMENT_STORAGE_ROOT ?? "/")}/`)) {
        throw new Error("A private evidence file outside storage is required.");
      }
      const evidenceStat = await lstat(evidencePath);
      if (!evidenceStat.isFile() || evidenceStat.nlink !== 1 || evidenceStat.size < 1 || evidenceStat.size > 1024 * 1024) {
        throw new Error("Evidence must be a regular file of at most 1 MiB.");
      }
      evidenceSha256 = createHash("sha256").update(await readFile(evidencePath)).digest("hex");
    }
    const objectStorage = backend === "s3" ? createS3AuditStorage(process.env) : undefined;
    let result;
    try {
      result = await reviewOrResolveFileWrite({ databaseUrl: process.env.DATABASE_URL,
        storageRoot: process.env.DOCUMENT_STORAGE_ROOT, objectStorage,
        quarantineRoot: process.env.FILE_WRITE_QUARANTINE_ROOT, operationId,
        ...(mode === "resolve" ? { reviewSha256, evidenceSha256, caseId, actor: actorWords.join(" ") } : {}) });
    } finally { objectStorage?.close(); }
    console.log(JSON.stringify(result));
    if (mode === "review" && !result.eligibleForManualResolution) process.exitCode = 2;
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.recovery_failed", code: error.code ?? "RECOVERY_FAILED", message: error.message }));
    process.exitCode = 1;
  }
}
