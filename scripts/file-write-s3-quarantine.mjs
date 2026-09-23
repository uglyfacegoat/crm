import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, STORAGE_KEY } from "./backup-integrity.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { verifyS3ExportCopy } from "./file-write-s3-export.mjs";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";
import { parseS3Config, storageBackend } from "../src/server/storage/s3-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createS3VersionRemover(environment) {
  const config = parseS3Config(environment);
  const accessKeyId = environment.FILE_WRITE_S3_QUARANTINE_ACCESS_KEY_ID;
  const secretAccessKey = environment.FILE_WRITE_S3_QUARANTINE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey || accessKeyId !== accessKeyId.trim()
    || secretAccessKey !== secretAccessKey.trim()) {
    throw new Error("Dedicated S3 quarantine credentials are required.");
  }
  const client = new S3Client({ endpoint: config.endpoint, region: config.region,
    credentials: { accessKeyId, secretAccessKey }, forcePathStyle: config.forcePathStyle,
    followRegionRedirects: false, maxAttempts: 1,
    requestHandler: { connectionTimeout: Math.min(config.timeoutMs, 5000), requestTimeout: config.timeoutMs } });
  return {
    async removeVersion(storageKey, versionId) {
      if (!STORAGE_KEY.test(storageKey ?? "") || typeof versionId !== "string" || !versionId) {
        throw new Error("A valid storage key and version ID are required.");
      }
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket,
        Key: storageKey, VersionId: versionId }), { abortSignal: AbortSignal.timeout(config.timeoutMs) });
    },
    close() { client.destroy(); },
  };
}

async function inventoryKey(objectStorage, storageKey) {
  const items = [];
  for await (const item of objectStorage.inventory()) {
    if (item.storageKey === storageKey) items.push(item);
  }
  return items;
}

async function assertUnreferenced(connection, storageKey) {
  const organizationId = storageKey.split("/")[0];
  for (const table of BACKUP_FILE_TABLES) {
    const [reference] = await connection`SELECT 1 FROM ${connection(table)}
      WHERE organization_id = ${organizationId}::uuid AND storage_key = ${storageKey} LIMIT 1`;
    if (reference) throw new Error("S3 key has a committed reference; quarantine refused.");
  }
}

function matchesManifest(item, saved) {
  return item.storageKey === saved.storageKey && item.versionId === saved.versionId
    && item.kind === saved.kind && item.sizeBytes === saved.sizeBytes
    && item.modifiedAt === saved.modifiedAt;
}

export async function quarantineS3Versions({ databaseUrl, exportRoot, objectStorage, versionRemover,
  operationId, storageKey, caseId, actor, onStage = () => {} }) {
  if (!databaseUrl || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120) {
    throw new Error("Valid database, operation, key, case ID and actor are required.");
  }
  if (!isAbsolute(exportRoot ?? "") || resolve(exportRoot) === "/"
    || !objectStorage || !versionRemover) {
    throw new Error("A private S3 export root, audit storage and version remover are required.");
  }
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_s3_quarantine" } });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        const [control] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
        if (control?.accepting !== false) throw new Error("Pause file writes before S3 quarantine.");
        const [operation] = await connection`SELECT storage_keys FROM file_write_operations WHERE id = ${operationId}::uuid`;
        if (!operation?.storage_keys.includes(storageKey)) throw new Error("Operation does not contain this storage key.");
        await assertUnreferenced(connection, storageKey);
        const [exportRecord] = await connection`SELECT export_path, manifest_sha256, manifest, case_id
          FROM file_write_s3_exports WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        if (!exportRecord || exportRecord.case_id !== caseId) {
          throw new Error("A completed S3 version export for the same case is required.");
        }
        const manifest = await verifyS3ExportCopy(exportRoot, operationId, storageKey, exportRecord);
        if (await objectStorage.versioning() !== "Enabled") throw new Error("Enabled bucket versioning is required.");
        let [record] = await connection`SELECT manifest_sha256, case_id, actor, state
          FROM file_write_s3_quarantine WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        if (record && (record.manifest_sha256 !== exportRecord.manifest_sha256
          || record.case_id !== caseId || record.actor !== actor.trim())) {
          throw new Error("S3 quarantine retry does not match its prepared record.");
        }
        const listed = await inventoryKey(objectStorage, storageKey);
        const versions = new Map(manifest.versions.map((item) => [item.versionId, item]));
        if (listed.some((item) => !matchesManifest(item, versions.get(item.versionId) ?? {}))) {
          throw new Error("S3 versions differ from the preserved manifest.");
        }
        if (record?.state === "complete") {
          if (listed.length) throw new Error("Completed S3 quarantine unexpectedly has live versions.");
          return { operationId, storageKey, caseId, versionCount: manifest.versions.length,
            completed: true, alreadyComplete: true };
        }
        if (!record) {
          // Durable prepared evidence is committed before the first irreversible S3 version delete.
          [record] = await connection`INSERT INTO file_write_s3_quarantine
            (operation_id, storage_key, manifest_sha256, case_id, actor, database_role, state)
            VALUES (${operationId}, ${storageKey}, ${exportRecord.manifest_sha256},
              ${caseId}, ${actor.trim()}, current_user, 'prepared')
            RETURNING manifest_sha256, case_id, actor, state`;
          onStage("prepared");
        }
        for (const item of listed) {
          await assertUnreferenced(connection, storageKey);
          await versionRemover.removeVersion(storageKey, item.versionId);
          onStage("version_deleted", item.versionId);
        }
        if (await objectStorage.versioning() !== "Enabled"
          || (await inventoryKey(objectStorage, storageKey)).length !== 0) {
          throw new Error("S3 quarantine did not remove every preserved version.");
        }
        await assertUnreferenced(connection, storageKey);
        await connection`UPDATE file_write_s3_quarantine SET state = 'complete', completed_at = now()
          WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        return { operationId, storageKey, caseId, versionCount: manifest.versions.length,
          completed: true, alreadyComplete: false };
      } finally { await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`; }
    } finally { connection.release(); }
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let objectStorage;
  let versionRemover;
  try {
    if (storageBackend(process.env) !== "s3") throw new Error("S3 storage backend is required for quarantine.");
    const [operationId, storageKey, caseId, ...actorWords] = process.argv.slice(2);
    if (process.argv.length < 6) throw new Error("Use <operation-id> <storage-key> <case-id> <operator-name>.");
    objectStorage = createS3AuditStorage(process.env);
    versionRemover = createS3VersionRemover(process.env);
    const result = await quarantineS3Versions({ databaseUrl: process.env.DATABASE_URL,
      exportRoot: process.env.FILE_WRITE_S3_EXPORT_ROOT,
      objectStorage, versionRemover, operationId, storageKey, caseId, actor: actorWords.join(" ") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.s3_quarantine_failed",
      code: error.code ?? "S3_QUARANTINE_FAILED", message: error.message }));
    process.exitCode = 1;
  } finally { objectStorage?.close(); versionRemover?.close(); }
}
