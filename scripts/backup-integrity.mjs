import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256File } from "./backup-process.mjs";
import { STORAGE_KEY } from "../src/server/storage/file-integrity.mjs";

const ARCHIVE_FILES = ["database.dump", "documents.tar.gz", "metadata.json"];
export { STORAGE_KEY };
export const BACKUP_FILE_TABLES = [
  "document_versions",
  "document_template_versions",
  "chat_message_attachments",
  "chat_channel_avatars",
];

export async function verifyBackupManifest(archiveDirectory) {
  if (!(await lstat(archiveDirectory)).isDirectory()) throw new Error("Backup archive must be a directory, not a link.");
  const manifestPath = join(archiveDirectory, "manifest.sha256");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.nlink !== 1 || manifestStat.size > 4096) {
    throw new Error("Backup checksum manifest is invalid.");
  }
  const manifest = await readFile(manifestPath, "utf8");
  const entries = manifest.trim().split("\n").map((line) => line.match(/^([a-f0-9]{64})  ([a-z0-9.-]+)$/));
  if (entries.length !== ARCHIVE_FILES.length || entries.some((entry) => !entry)
    || new Set(entries.map((entry) => entry[2])).size !== ARCHIVE_FILES.length
    || entries.some((entry) => !ARCHIVE_FILES.includes(entry[2]))) {
    throw new Error("Backup checksum manifest is invalid.");
  }
  for (const [, expectedHash, fileName] of entries) {
    const filePath = join(archiveDirectory, fileName);
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile() || fileStat.nlink !== 1) throw new Error("Backup members must be regular files, not links.");
    if (await sha256File(filePath) !== expectedHash) throw new Error(`Backup checksum mismatch for ${fileName}.`);
  }
}

export function validateDocumentArchive(rawEntries, verboseEntries) {
  const entries = rawEntries.trimEnd().split("\n");
  const descriptions = verboseEntries.trimEnd().split("\n");
  if (entries.length !== descriptions.length
    || descriptions.some((line) => !/^[-d]/.test(line) || line.includes(" -> ") || line.includes(" link to "))) {
    throw new Error("Document backup contains a link or unsupported archive entry.");
  }
  const seen = new Set();
  for (const entry of entries) {
    // Storage has generated ASCII paths only; rejecting other names also avoids tar's escaped-name ambiguity.
    const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
    const validDirectory = normalized === "" || normalized === "."
      || /^[0-9a-f-]{36}(\/[0-9a-f-]{36})?$/.test(normalized);
    if (!validDirectory && !STORAGE_KEY.test(normalized)) throw new Error("Document backup contains an unsafe archive path.");
    if (seen.has(normalized)) throw new Error("Document backup contains duplicate archive paths.");
    seen.add(normalized);
  }
}

export function validateFileReference(reference) {
  const { storage_key: storageKey, organization_id: organizationId, sha256 } = reference;
  const sizeBytes = Number(reference.size_bytes);
  if (typeof storageKey !== "string" || !STORAGE_KEY.test(storageKey)
    || storageKey.split("/")[0] !== organizationId
    || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 15 * 1024 * 1024
    || typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Restored file reference has invalid metadata.");
  }
  return { storageKey, sizeBytes, sha256 };
}

export async function verifyRestoredFile(storageRoot, reference) {
  const { storageKey, sizeBytes, sha256 } = validateFileReference(reference);
  const [organizationDirectory, recordDirectory] = storageKey.split("/");
  for (const directory of [storageRoot, join(storageRoot, organizationDirectory), join(storageRoot, organizationDirectory, recordDirectory)]) {
    if (!(await lstat(directory)).isDirectory()) throw new Error("Restored file path contains a link or non-directory.");
  }
  const file = await open(join(storageRoot, storageKey), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size !== sizeBytes) throw new Error("Restored file size or type does not match its database reference.");
    const hash = createHash("sha256");
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await file.stat();
    if (hash.digest("hex") !== sha256 || after.size !== sizeBytes || after.mtimeMs !== before.mtimeMs) {
      throw new Error("Restored file checksum does not match its database reference.");
    }
    return sizeBytes;
  } finally {
    await file.close();
  }
}

export async function verifyRestoredFiles(sql, storageRoot) {
  const fileCounts = {};
  let verifiedFileBytes = 0;
  for (const table of BACKUP_FILE_TABLES) {
    fileCounts[table] = 0;
    // Include historical versions and soft-deleted messages: their retained references must remain recoverable.
    for await (const references of sql`SELECT organization_id, storage_key, size_bytes, sha256 FROM ${sql(table)}`.cursor(100)) {
      for (const reference of references) {
        verifiedFileBytes += await verifyRestoredFile(storageRoot, reference);
        fileCounts[table] += 1;
      }
    }
  }
  return { verifiedFileCounts: fileCounts, verifiedFileBytes };
}
