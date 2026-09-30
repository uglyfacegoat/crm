import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, STORAGE_KEY } from "./backup-integrity.mjs";
import { FILE_WRITE_LOCK_CLASS, FILE_WRITE_LOCK_ID } from "../src/server/file-writes/lock-key.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

async function realDirectory(path, privateDirectory = false) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || (privateDirectory && (stat.mode & 0o077) !== 0)) {
    throw new Error("Storage and quarantine roots must be real directories; quarantine must be private.");
  }
  return stat;
}

export async function fileDigest(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > MAX_FILE_BYTES) {
      throw new Error("Quarantine source is not a regular, singly linked business file.");
    }
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("File changed while hashing.");
    return { sizeBytes: before.size, sha256: hash.digest("hex") };
  } finally { await file.close(); }
}

export async function verifyQuarantineCopy(quarantineRoot, operationId, storageKey, record) {
  if (!isAbsolute(quarantineRoot ?? "") || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")) {
    throw new Error("A valid quarantine root, operation and storage key are required.");
  }
  const root = resolve(quarantineRoot);
  await realDirectory(root, true);
  const relativePath = join(operationId, `${createHash("sha256").update(storageKey).digest("hex")}.bin`);
  if (record.quarantine_path !== relativePath || record.state !== "complete") throw new Error("Quarantine record is incomplete or has an invalid destination.");
  const directory = join(root, operationId);
  await realDirectory(directory, true);
  const destinationPath = join(root, relativePath);
  const stat = await lstat(destinationPath);
  if ((stat.mode & 0o077) !== 0) throw new Error("Quarantine copy is not private.");
  const actual = await fileDigest(destinationPath);
  if (actual.sizeBytes !== Number(record.size_bytes) || actual.sha256 !== record.sha256) {
    throw new Error("Quarantine copy does not match its recorded checksum.");
  }
  return actual;
}

async function optionalDigest(path) {
  try { return await fileDigest(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function syncDirectory(path) {
  const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try { await directory.sync(); }
  finally { await directory.close(); }
}

async function assertUnreferenced(connection, storageKey) {
  const organizationId = storageKey.split("/")[0];
  for (const table of BACKUP_FILE_TABLES) {
    const [reference] = await connection`SELECT 1 FROM ${connection(table)}
      WHERE organization_id = ${organizationId}::uuid AND storage_key = ${storageKey} LIMIT 1`;
    if (reference) throw new Error("File has a committed database reference; quarantine refused.");
  }
}

export async function quarantineFileWrite({ databaseUrl, storageRoot, quarantineRoot, operationId, storageKey, caseId, actor,
  onStage = () => {} }) {
  if (!databaseUrl || !UUID.test(operationId ?? "") || !STORAGE_KEY.test(storageKey ?? "")
    || !/^[A-Za-z0-9._-]{3,80}$/.test(caseId ?? "") || typeof actor !== "string"
    || actor.trim().length < 3 || actor.trim().length > 120) throw new Error("Valid operation, key, case ID and actor are required.");
  if (!isAbsolute(storageRoot ?? "") || !isAbsolute(quarantineRoot ?? "")) throw new Error("Explicit absolute storage and quarantine roots are required.");
  const sourceRoot = resolve(storageRoot);
  const safeQuarantineRoot = resolve(quarantineRoot);
  if (sourceRoot === "/" || safeQuarantineRoot === "/" || sourceRoot === safeQuarantineRoot
    || sourceRoot.startsWith(`${safeQuarantineRoot}${sep}`) || safeQuarantineRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error("Storage and quarantine roots must be separate.");
  }
  await realDirectory(sourceRoot);
  await realDirectory(safeQuarantineRoot, true);
  const segments = storageKey.split("/");
  for (const length of [1, 2]) await realDirectory(join(sourceRoot, ...segments.slice(0, length)));
  const sourcePath = join(sourceRoot, ...segments);
  const relativePath = join(operationId, `${createHash("sha256").update(storageKey).digest("hex")}.bin`);
  const destinationDirectory = join(safeQuarantineRoot, operationId);
  const destinationPath = join(safeQuarantineRoot, relativePath);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10,
    connection: { application_name: "crm_file_write_quarantine" } });
  try {
    const connection = await sql.reserve();
    try {
      await connection`SET statement_timeout = '120000ms'`;
      await connection`SELECT pg_advisory_lock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`;
      try {
        const [control] = await connection`SELECT accepting FROM file_write_control WHERE id = true`;
        if (control?.accepting !== false) throw new Error("Pause file writes before quarantine.");
        const [operation] = await connection`SELECT storage_keys FROM file_write_operations WHERE id = ${operationId}::uuid`;
        if (!operation?.storage_keys.includes(storageKey)) throw new Error("Operation does not contain this storage key.");
        await assertUnreferenced(connection, storageKey);
        let [record] = await connection`SELECT quarantine_path, size_bytes, sha256, case_id, actor, state
          FROM file_write_quarantine WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        if (record && (record.quarantine_path !== relativePath || record.case_id !== caseId || record.actor !== actor.trim())) {
          throw new Error("Quarantine retry does not match the recorded case and destination.");
        }
        if (!record) {
          const source = await fileDigest(sourcePath);
          [record] = await connection`INSERT INTO file_write_quarantine
            (operation_id, storage_key, quarantine_path, size_bytes, sha256, case_id, actor, database_role, state)
            VALUES (${operationId}, ${storageKey}, ${relativePath}, ${source.sizeBytes}, ${source.sha256},
              ${caseId}, ${actor.trim()}, current_user, 'prepared')
            RETURNING quarantine_path, size_bytes, sha256, case_id, actor, state`;
          onStage("prepared");
        }
        try { await mkdir(destinationDirectory, { mode: 0o700 }); }
        catch (error) { if (error.code !== "EEXIST") throw error; }
        await realDirectory(destinationDirectory, true);
        await syncDirectory(safeQuarantineRoot);
        const expected = { sizeBytes: Number(record.size_bytes), sha256: record.sha256 };
        let destination = await optionalDigest(destinationPath);
        if (!destination && record.state !== "complete") {
          await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
          destination = await fileDigest(destinationPath);
        }
        if (!destination || destination.sizeBytes !== expected.sizeBytes || destination.sha256 !== expected.sha256) {
          throw new Error("Quarantine copy is missing or does not match its prepared checksum.");
        }
        const copied = await open(destinationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { await copied.chmod(0o600); await copied.sync(); }
        finally { await copied.close(); }
        await syncDirectory(destinationDirectory);
        const source = await optionalDigest(sourcePath);
        if (record.state === "complete") {
          if (source) throw new Error("Completed quarantine unexpectedly has a source file.");
          return { operationId, storageKey, quarantinePath: relativePath, ...expected, completed: true, alreadyComplete: true };
        }
        onStage("copied");
        if (source) {
          if (source.sizeBytes !== expected.sizeBytes || source.sha256 !== expected.sha256) throw new Error("Source changed before quarantine removal.");
          await assertUnreferenced(connection, storageKey);
          await unlink(sourcePath);
          await syncDirectory(dirname(sourcePath));
        }
        onStage("source_unlinked");
        await connection`UPDATE file_write_quarantine SET state = 'complete', completed_at = now()
          WHERE operation_id = ${operationId}::uuid AND storage_key = ${storageKey}`;
        return { operationId, storageKey, quarantinePath: relativePath, ...expected, completed: true, alreadyComplete: false };
      } finally { await connection`SELECT pg_advisory_unlock(${FILE_WRITE_LOCK_CLASS}, ${FILE_WRITE_LOCK_ID})`; }
    } finally { connection.release(); }
  } finally { await sql.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (storageBackend(process.env) !== "local") throw new Error("Local storage backend is required for quarantine.");
    if (process.argv.length < 6) throw new Error("Use <operation-id> <storage-key> <case-id> <operator-name>.");
    const [operationId, storageKey, caseId, ...actorWords] = process.argv.slice(2);
    const result = await quarantineFileWrite({ databaseUrl: process.env.DATABASE_URL,
      storageRoot: process.env.DOCUMENT_STORAGE_ROOT, quarantineRoot: process.env.FILE_WRITE_QUARANTINE_ROOT,
      operationId, storageKey, caseId, actor: actorWords.join(" ") });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ event: "file_write.quarantine_failed", code: safeCliErrorCode(error, "QUARANTINE_FAILED") }));
    process.exitCode = 1;
  }
}
