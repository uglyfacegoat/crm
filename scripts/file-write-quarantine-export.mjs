import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, lstat, open } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { STORAGE_KEY } from "./backup-integrity.mjs";
import { fileDigest, verifyQuarantineCopy } from "./file-write-quarantine.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function separate(left, right) {
  return left !== right && !left.startsWith(`${right}${sep}`) && !right.startsWith(`${left}${sep}`);
}

export async function exportQuarantineCopy({ databaseUrl, storageRoot, quarantineRoot, exportRoot,
  operationId, storageKey, caseId }) {
  if (!databaseUrl || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "")) {
    throw new Error("Valid database, operation, storage key and case ID are required.");
  }
  if (![storageRoot, quarantineRoot, exportRoot].every((path) => isAbsolute(path ?? ""))) {
    throw new Error("Explicit absolute storage, quarantine and export roots are required.");
  }
  const [storage, quarantine, destination] = [storageRoot, quarantineRoot, exportRoot].map((path) => resolve(path));
  if ([storage, quarantine, destination].includes("/") || !separate(storage, quarantine)
    || !separate(storage, destination) || !separate(quarantine, destination)) {
    throw new Error("Storage, quarantine and export roots must be separate.");
  }
  const [storageStat, exportStat] = await Promise.all([lstat(storage), lstat(destination)]);
  if (!storageStat.isDirectory()) throw new Error("Storage root must be a real directory.");
  if (!exportStat.isDirectory() || (exportStat.mode & 0o077) !== 0) {
    throw new Error("Export root must be a private real directory.");
  }
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_quarantine_export" } });
  try {
    const [record] = await sql`SELECT quarantine_path, size_bytes, sha256, case_id, state
      FROM file_write_quarantine WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
    if (!record || record.case_id !== caseId || record.state !== "complete") {
      throw new Error("Completed quarantine record with matching case ID is required.");
    }
    await verifyQuarantineCopy(quarantine, operationId, storageKey, record);
    const keyHash = createHash("sha256").update(storageKey).digest("hex");
    const destinationPath = join(destination, `${operationId}-${keyHash}.bin`);
    await copyFile(join(quarantine, record.quarantine_path), destinationPath, constants.COPYFILE_EXCL);
    const copied = await open(destinationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await copied.chmod(0o600); await copied.sync(); }
    finally { await copied.close(); }
    const exported = await lstat(destinationPath);
    if (!exported.isFile() || exported.nlink !== 1 || (exported.mode & 0o077) !== 0) {
      throw new Error("Export is not a private regular file.");
    }
    // The source can change between verification and copy, so verify the staged bytes again.
    const digest = await fileDigest(destinationPath);
    if (digest.sizeBytes !== Number(record.size_bytes) || digest.sha256 !== record.sha256) {
      throw new Error("Exported bytes do not match the quarantine checksum.");
    }
    const directory = await open(destination, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); }
    finally { await directory.close(); }
    return { operationId, storageKey, caseId, exportPath: destinationPath,
      sizeBytes: Number(record.size_bytes), sha256: record.sha256 };
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (storageBackend(process.env) !== "local") throw new Error("Local storage backend is required for quarantine export.");
    const [operationId, storageKey, caseId, exportRoot] = process.argv.slice(2);
    if (process.argv.length !== 6) throw new Error("Use <operation-id> <storage-key> <case-id> <absolute-export-root>.");
    const result = await exportQuarantineCopy({ databaseUrl: process.env.DATABASE_URL,
      storageRoot: process.env.DOCUMENT_STORAGE_ROOT,
      quarantineRoot: process.env.FILE_WRITE_QUARANTINE_ROOT,
      exportRoot, operationId, storageKey, caseId });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.quarantine_export_failed",
      code: safeCliErrorCode(error, "QUARANTINE_EXPORT_FAILED") }));
    process.exitCode = 1;
  }
}
