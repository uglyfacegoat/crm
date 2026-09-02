import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const storageRootSchema = z.string().min(1).refine(isAbsolute, "DOCUMENT_STORAGE_ROOT must be an absolute path");

function getStorageRoot() {
  const configuredRoot = process.env.DOCUMENT_STORAGE_ROOT;
  if (configuredRoot) return resolve(storageRootSchema.parse(configuredRoot));
  if (process.env.NODE_ENV === "production") throw new Error("DOCUMENT_STORAGE_ROOT is required in production.");
  return resolve(process.cwd(), ".crm-storage");
}

function resolveStorageKey(storageKey: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/v[1-9][0-9]*\.(pdf|jpg|png|webp|docx|xlsx)$/.test(storageKey)) {
    throw new Error("Invalid document storage key.");
  }
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

export async function writeDocumentFile(storageKey: string, buffer: Buffer) {
  const absolutePath = resolveStorageKey(storageKey);
  await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 });
  await writeFile(absolutePath, buffer, { flag: "wx", mode: 0o600 });
}

export async function readDocumentFile(storageKey: string) {
  return readFile(resolveStorageKey(storageKey));
}

export async function removeDocumentFile(storageKey: string) {
  try {
    await unlink(resolveStorageKey(storageKey));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}
