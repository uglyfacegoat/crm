import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { STORAGE_KEY } from "./backup-integrity.mjs";
import { fileDigest } from "./file-write-quarantine.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function privateDirectory(path, create = false) {
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new Error("S3 export directories must be real and private.");
  }
}

async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); }
  finally { await directory.close(); }
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }

async function assertFile(path, expected) {
  const stat = await lstat(path);
  if ((stat.mode & 0o077) !== 0) throw new Error("S3 export copy is not private.");
  const actual = await fileDigest(path);
  if (actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
    throw new Error("S3 export copy does not match its version checksum.");
  }
}

export async function exportS3Versions({ databaseUrl, exportRoot, storageRoot, objectStorage,
  operationId, storageKey, caseId, actor }) {
  if (!databaseUrl || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120) {
    throw new Error("Valid database, operation, key, case ID and actor are required.");
  }
  if (!isAbsolute(exportRoot ?? "") || resolve(exportRoot) === "/" || !objectStorage) {
    throw new Error("An explicit private S3 export root and audit storage are required.");
  }
  const root = resolve(exportRoot);
  if (storageRoot && (!isAbsolute(storageRoot) || root === resolve(storageRoot)
    || root.startsWith(`${resolve(storageRoot)}${sep}`)
    || resolve(storageRoot).startsWith(`${root}${sep}`))) {
    throw new Error("S3 export root must be separate from document storage.");
  }
  await privateDirectory(root);
  const keyHash = hash(storageKey);
  const operationDirectory = join(root, operationId);
  const keyDirectory = join(operationDirectory, keyHash);
  const relativeManifestPath = join(operationId, keyHash, "manifest.json");
  const manifestPath = join(root, relativeManifestPath);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_s3_export" } });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        const [control] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
        if (control?.accepting !== false) throw new Error("Pause file writes before S3 version export.");
        const [operation] = await connection`SELECT storage_keys FROM file_write_operations WHERE id = ${operationId}::uuid`;
        if (!operation?.storage_keys.includes(storageKey)) throw new Error("Operation does not contain this storage key.");
        const versioning = await objectStorage.versioning();
        if (versioning !== "Enabled") throw new Error("Enabled bucket versioning is required for version export.");
        const items = [];
        for await (const item of objectStorage.inventory()) {
          if (item.storageKey === storageKey) items.push(item);
        }
        if (!items.length || items.filter((item) => item.isLatest).length !== 1
          || new Set(items.map((item) => item.versionId)).size !== items.length) {
          throw new Error("Object version inventory is empty or inconsistent.");
        }
        items.sort((a, b) => a.versionId.localeCompare(b.versionId));
        await privateDirectory(operationDirectory, true);
        await privateDirectory(keyDirectory, true);
        const versions = [];
        for (const item of items) {
          if (item.kind === "delete-marker") {
            versions.push({ ...item, sha256: null, file: null });
            continue;
          }
          const { bytes, sha256 } = await objectStorage.readVersion(storageKey, item.versionId, item.sizeBytes);
          const name = `${hash(item.versionId)}.bin`;
          const file = join(keyDirectory, name);
          const expected = { sizeBytes: item.sizeBytes, sha256 };
          try {
            await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
          } catch (error) { if (error.code !== "EEXIST") throw error; }
          await assertFile(file, expected);
          const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
          try { await handle.sync(); }
          finally { await handle.close(); }
          versions.push({ ...item, sha256, file: name });
        }
        await syncDirectory(keyDirectory);
        const manifest = { operationId, storageKey, caseId, versioning, versions };
        const manifestBytes = Buffer.from(JSON.stringify(manifest));
        const manifestSha256 = hash(manifestBytes);
        let alreadyExported = false;
        try { await writeFile(manifestPath, manifestBytes, { flag: "wx", mode: 0o600 }); }
        catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (!(await readFile(manifestPath)).equals(manifestBytes)) {
            throw new Error("Existing S3 version manifest differs from current inventory.");
          }
          alreadyExported = true;
        }
        await assertFile(manifestPath, { sizeBytes: manifestBytes.length, sha256: manifestSha256 });
        const manifestFile = await open(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await manifestFile.sync(); }
        finally { await manifestFile.close(); }
        await syncDirectory(keyDirectory);
        await syncDirectory(operationDirectory);
        if (await objectStorage.versioning() !== versioning) throw new Error("Bucket versioning changed during export.");
        const after = [];
        for await (const item of objectStorage.inventory()) {
          if (item.storageKey === storageKey) after.push(item);
        }
        after.sort((a, b) => a.versionId.localeCompare(b.versionId));
        if (JSON.stringify(after) !== JSON.stringify(items)) {
          throw new Error("Object version inventory changed during export.");
        }
        const [existing] = await connection`SELECT export_path, manifest_sha256, case_id, actor
          FROM file_write_s3_exports WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        if (existing) {
          if (existing.export_path !== relativeManifestPath || existing.manifest_sha256 !== manifestSha256
            || existing.case_id !== caseId || existing.actor !== actor.trim()) {
            throw new Error("Existing S3 export audit does not match this attempt.");
          }
          alreadyExported = true;
        } else {
          await connection`INSERT INTO file_write_s3_exports
            (operation_id, storage_key, export_path, manifest_sha256, manifest, case_id, actor, database_role)
            VALUES (${operationId}, ${storageKey}, ${relativeManifestPath}, ${manifestSha256},
              ${connection.json(manifest)}, ${caseId}, ${actor.trim()}, current_user)`;
        }
        return { operationId, storageKey, caseId, manifestPath: relativeManifestPath,
          manifestSha256, versionCount: versions.length, alreadyExported };
      } finally { await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`; }
    } finally { connection.release(); }
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let objectStorage;
  try {
    if (storageBackend(process.env) !== "s3") throw new Error("S3 storage backend is required for version export.");
    const [operationId, storageKey, caseId, ...actorWords] = process.argv.slice(2);
    if (process.argv.length < 6) throw new Error("Use <operation-id> <storage-key> <case-id> <operator-name>.");
    objectStorage = createS3AuditStorage(process.env);
    const result = await exportS3Versions({ databaseUrl: process.env.DATABASE_URL,
      exportRoot: process.env.FILE_WRITE_S3_EXPORT_ROOT,
      storageRoot: process.env.DOCUMENT_STORAGE_ROOT,
      objectStorage, operationId, storageKey, caseId, actor: actorWords.join(" ") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.s3_export_failed",
      code: error.code ?? "S3_EXPORT_FAILED", message: error.message }));
    process.exitCode = 1;
  } finally { objectStorage?.close(); }
}
