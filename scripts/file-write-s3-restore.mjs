import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { STORAGE_KEY } from "./backup-integrity.mjs";
import { verifyS3ExportCopy } from "./file-write-s3-export.mjs";
import { parseS3Config, storageBackend } from "../src/server/storage/s3-config.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function createS3RestoreTarget(environment) {
  const source = parseS3Config(environment);
  const targetEnvironment = {
    DOCUMENT_S3_ENDPOINT: environment.FILE_WRITE_S3_RESTORE_ENDPOINT,
    DOCUMENT_S3_REGION: environment.FILE_WRITE_S3_RESTORE_REGION,
    DOCUMENT_S3_BUCKET: environment.FILE_WRITE_S3_RESTORE_BUCKET,
    DOCUMENT_S3_ACCESS_KEY_ID: environment.FILE_WRITE_S3_RESTORE_ACCESS_KEY_ID,
    DOCUMENT_S3_SECRET_ACCESS_KEY: environment.FILE_WRITE_S3_RESTORE_SECRET_ACCESS_KEY,
    DOCUMENT_S3_FORCE_PATH_STYLE: environment.FILE_WRITE_S3_RESTORE_FORCE_PATH_STYLE,
    DOCUMENT_S3_ALLOW_LOCAL_HTTP: environment.FILE_WRITE_S3_RESTORE_ALLOW_LOCAL_HTTP,
    DOCUMENT_S3_TIMEOUT_MS: environment.FILE_WRITE_S3_RESTORE_TIMEOUT_MS,
  };
  const target = parseS3Config(targetEnvironment);
  if (source.endpoint === target.endpoint && source.bucket === target.bucket) {
    throw new Error("Restore destination must be a separate bucket or endpoint.");
  }
  const files = createS3Storage(targetEnvironment);
  return {
    endpoint: target.endpoint,
    bucket: target.bucket,
    async putAndVerify(key, bytes, expected) {
      if (!STORAGE_KEY.test(key) || !Buffer.isBuffer(bytes) || bytes.length !== expected.sizeBytes
        || !SHA256.test(expected.sha256) || hash(bytes) !== expected.sha256) {
        throw new Error("Restore bytes do not match the preserved version.");
      }
      try { await files.write(key, bytes); }
      catch (error) {
        // A lost PUT response can still mean the conditional write committed.
        try { await files.readVerified(key, expected, 15 * 1024 * 1024); }
        catch { throw error; }
      }
      await files.readVerified(key, expected, 15 * 1024 * 1024);
    },
    close() { files.close(); },
  };
}

function versionTargetKey(operationId, storageKey, versionId) {
  const digest = hash(`${storageKey}\0${versionId}`);
  const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  const extension = storageKey.slice(storageKey.lastIndexOf(".") + 1);
  return `${operationId}/${uuid}/v1.${extension}`;
}

export async function restoreS3QuarantineArchive({ databaseUrl, exportRoot, target, operationId,
  storageKey, caseId, actor }) {
  if (!databaseUrl || !isAbsolute(exportRoot ?? "") || resolve(exportRoot) === "/"
    || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120 || !target?.endpoint || !target?.bucket) {
    throw new Error("Valid archive, target, operation, case ID and actor are required.");
  }
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_s3_restore" } });
  try {
    const [quarantine] = await sql`SELECT manifest_sha256, case_id, state FROM file_write_s3_quarantine
      WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
    const [exportRecord] = await sql`SELECT export_path, manifest_sha256, manifest, case_id FROM file_write_s3_exports
      WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
    if (quarantine?.state !== "complete" || quarantine.case_id !== caseId || !exportRecord
      || exportRecord.case_id !== caseId || quarantine.manifest_sha256 !== exportRecord.manifest_sha256) {
      throw new Error("A completed S3 quarantine archive for the same case is required.");
    }
    const manifest = await verifyS3ExportCopy(exportRoot, operationId, storageKey, exportRecord);
    const targetId = hash(`${target.endpoint}\n${target.bucket}`);
    const versions = [];
    const keyHash = hash(storageKey);
    for (const item of manifest.versions) {
      if (item.kind === "delete-marker") {
        versions.push({ sourceVersionId: item.versionId, kind: item.kind, targetKey: null });
        continue;
      }
      const bytes = await readFile(join(resolve(exportRoot), operationId, keyHash, item.file));
      const targetKey = versionTargetKey(operationId, storageKey, item.versionId);
      await target.putAndVerify(targetKey, bytes, { sizeBytes: item.sizeBytes, sha256: item.sha256 });
      versions.push({ sourceVersionId: item.versionId, kind: item.kind,
        targetKey, sizeBytes: item.sizeBytes, sha256: item.sha256 });
    }
    const report = { operationId, storageKey, caseId, manifestSha256: exportRecord.manifest_sha256,
      target: { endpoint: target.endpoint, bucket: target.bucket }, versions };
    const reportSha256 = hash(JSON.stringify(report));
    const [existing] = await sql`SELECT manifest_sha256, report_sha256, report, case_id, actor
      FROM file_write_s3_restore_drills WHERE operation_id = ${operationId}::uuid
        AND storage_key = ${storageKey} AND target_id = ${targetId}`;
    if (existing) {
      if (existing.manifest_sha256 !== exportRecord.manifest_sha256
        || existing.report_sha256 !== reportSha256 || existing.case_id !== caseId
        || existing.actor !== actor.trim()) throw new Error("Restore drill audit differs from this attempt.");
    } else {
      await sql`INSERT INTO file_write_s3_restore_drills
        (operation_id, storage_key, target_id, manifest_sha256, report_sha256, report,
          case_id, actor, database_role)
        VALUES (${operationId}, ${storageKey}, ${targetId}, ${exportRecord.manifest_sha256},
          ${reportSha256}, ${sql.json(report)}, ${caseId}, ${actor.trim()}, current_user)`;
    }
    return { ...report, reportSha256, alreadyRestored: Boolean(existing) };
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let target;
  try {
    if (storageBackend(process.env) !== "s3") throw new Error("S3 storage backend is required for archive restore.");
    const [operationId, storageKey, caseId, ...actorWords] = process.argv.slice(2);
    if (process.argv.length < 6) throw new Error("Use <operation-id> <storage-key> <case-id> <operator-name>.");
    target = createS3RestoreTarget(process.env);
    const result = await restoreS3QuarantineArchive({ databaseUrl: process.env.DATABASE_URL,
      exportRoot: process.env.FILE_WRITE_S3_EXPORT_ROOT, target,
      operationId, storageKey, caseId, actor: actorWords.join(" ") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.s3_restore_failed",
      code: safeCliErrorCode(error, "S3_RESTORE_FAILED") }));
    process.exitCode = 1;
  } finally { target?.close(); }
}
