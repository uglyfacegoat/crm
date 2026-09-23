import "server-only";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { storageRootSchema } from "@/server/config/environment";
import { storageBackend } from "../storage/s3-config.mjs";
import { recordFileWriteKey } from "../file-writes/gate.mjs";
import { createS3Storage } from "../storage/s3-store.mjs";
import { StoredFileIntegrityError, validateFileExpectation, validateStorageKey } from "../storage/file-integrity.mjs";

export { StoredFileIntegrityError };

let s3: ReturnType<typeof createS3Storage> | undefined;
function objectStorage() {
  return s3 ??= createS3Storage(process.env);
}

function getStorageRoot() {
  const configuredRoot = process.env.DOCUMENT_STORAGE_ROOT;
  if (configuredRoot) return resolve(storageRootSchema.parse(configuredRoot));
  if (process.env.NODE_ENV === "production") throw new Error("DOCUMENT_STORAGE_ROOT is required in production.");
  return resolve(process.cwd(), ".crm-storage");
}

function resolveStorageKey(storageKey: string) {
  validateStorageKey(storageKey);
  const root = getStorageRoot();
  const absolutePath = resolve(root, ...storageKey.split("/"));
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    throw new Error("Document storage key escapes the configured root.");
  }
  return absolutePath;
}

export function createDocumentStorageKey(organizationId: string, documentId: string, extension: string) {
  return `${organizationId}/${documentId}/v1.${extension}`;
}

export function createDocumentVersionStorageKey(organizationId: string, documentId: string, versionNumber: number, extension: string) {
  if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new TypeError("Document version number must be a positive integer.");
  return `${organizationId}/${documentId}/v${versionNumber}.${extension}`;
}

export function createDocumentTemplateStorageKey(organizationId: string, templateId: string, extension: string) {
  return `${organizationId}/${templateId}/v1.${extension}`;
}

export function createChatAttachmentStorageKey(organizationId: string, messageId: string, extension: string) {
  return `${organizationId}/${messageId}/v1.${extension}`;
}

export function createChatChannelAvatarStorageKey(organizationId: string, channelId: string, version: number, extension: string) {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("Chat avatar version must be a positive integer.");
  return `${organizationId}/${channelId}/v${version}.${extension}`;
}

export async function writeDocumentFile(storageKey: string, buffer: Buffer) {
  await recordFileWriteKey(storageKey);
  if (storageBackend(process.env) === "s3") return objectStorage().write(storageKey, buffer);
  const absolutePath = resolveStorageKey(storageKey);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });
}

export async function readVerifiedDocumentFile(storageKey: string, expected: { sizeBytes: number; sha256: string }, maxBytes: number) {
  if (storageBackend(process.env) === "s3") return objectStorage().readVerified(storageKey, expected, maxBytes);
  validateFileExpectation(expected, maxBytes);
  const file = await open(resolveStorageKey(storageKey), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await file.stat();
    if (!stats.isFile() || stats.size !== expected.sizeBytes) throw new StoredFileIntegrityError();
    // Allocate only the validated stored size, even if the file grows during reading.
    const buffer = Buffer.alloc(expected.sizeBytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) throw new StoredFileIntegrityError();
      offset += bytesRead;
    }
    if ((await file.stat()).size !== expected.sizeBytes || createHash("sha256").update(buffer).digest("hex") !== expected.sha256) {
      throw new StoredFileIntegrityError();
    }
    return buffer;
  } finally {
    await file.close();
  }
}

export async function removeDocumentFile(storageKey: string) {
  if (storageBackend(process.env) === "s3") return objectStorage().remove(storageKey);
  try {
    await unlink(resolveStorageKey(storageKey));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
