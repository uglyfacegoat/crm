import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
    if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
mock.module("server-only", { namedExports: {} });
const storageUrl = new URL("server/documents/storage.ts", root);
const storage = await import(storageUrl.href);
const readStoredFile = mock.fn(storage.readVerifiedDocumentFile);
mock.module(storageUrl, { namedExports: { readVerifiedDocumentFile: readStoredFile, StoredFileIntegrityError: storage.StoredFileIntegrityError } });
const getCurrentSession = mock.fn();
const getDocumentDownload = mock.fn();
const getDocumentVersionDownload = mock.fn();
const getDocumentTemplateDownload = mock.fn();
const getChatChannelAvatarDownload = mock.fn();
const getDocumentBatchExport = mock.fn();
const recordDocumentBatchExport = mock.fn();
class DocumentNotFoundError extends Error {}
class DocumentTemplateNotFoundError extends Error {}
class ChatChannelNotFoundError extends Error {}
mock.module(new URL("server/auth/session.ts", root), { namedExports: { getCurrentSession } });
mock.module(new URL("server/documents/repository.ts", root), { namedExports: { getDocumentDownload, getDocumentVersionDownload, getDocumentBatchExport, recordDocumentBatchExport, DocumentNotFoundError } });
mock.module(new URL("server/document-templates/repository.ts", root), { namedExports: { getDocumentTemplateDownload, DocumentTemplateNotFoundError } });
mock.module(new URL("server/chat/repository.ts", root), { namedExports: { getChatChannelAvatarDownload, ChatChannelNotFoundError } });
const { GET: download } = await import("../src/app/api/v1/documents/[id]/download/route.ts");
const { GET: version } = await import("../src/app/api/v1/documents/[id]/versions/[versionId]/download/route.ts");
const { GET: template } = await import("../src/app/api/v1/document-templates/[id]/download/route.ts");
const { GET: avatar } = await import("../src/app/api/v1/chat/channels/[id]/avatar/route.ts");
const { GET: preview } = await import("../src/app/api/v1/documents/[id]/preview/route.ts");
const { POST: batchExport } = await import("../src/app/api/v1/documents/export/route.ts");

test("all document readers bound file allocation and preserve access checks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "crm-document-read-"));
  const previousRoot = process.env.DOCUMENT_STORAGE_ROOT;
  process.env.DOCUMENT_STORAGE_ROOT = directory;
  const log = mock.method(console, "error", () => {});
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.DOCUMENT_STORAGE_ROOT;
    else process.env.DOCUMENT_STORAGE_ROOT = previousRoot;
    mock.restoreAll(); hooks.deregister();
    await rm(directory, { recursive: true });
  });
  const member = { memberId: randomUUID(), organizationId: randomUUID() };
  const bytes = Buffer.from("bounded-download-fixture");
  const file = {
    id: randomUUID(), documentId: randomUUID(), channelId: randomUUID(), filename: "документ.pdf", mimeType: "application/pdf",
    sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    clientId: randomUUID(), clientName: "Клиент", objectId: randomUUID(), objectName: "Объект", orderNumber: "1001", category: "act",
  };
  file.storageKey = storage.createDocumentStorageKey(member.organizationId, file.documentId, "pdf");
  await storage.writeDocumentFile(file.storageKey, bytes);
  const context = { params: Promise.resolve({ id: file.documentId, versionId: file.id }) };
  const endpoints = [
    ["document", download, getDocumentDownload, DocumentNotFoundError, 15 * 1024 * 1024],
    ["version", version, getDocumentVersionDownload, DocumentNotFoundError, 15 * 1024 * 1024],
    ["template", template, getDocumentTemplateDownload, DocumentTemplateNotFoundError, 15 * 1024 * 1024],
    ["avatar", avatar, getChatChannelAvatarDownload, ChatChannelNotFoundError, 3 * 1024 * 1024],
    ["preview", preview, getDocumentDownload, DocumentNotFoundError, 15 * 1024 * 1024],
  ];
  const send = (handler) => handler(new Request("http://localhost/file"), context);
  const exportFiles = () => batchExport(new Request("http://localhost/api/v1/documents/export", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ documentIds: [file.documentId] }),
  }));
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  t.beforeEach(() => {
    for (const fn of [getCurrentSession, getDocumentDownload, getDocumentVersionDownload, getDocumentTemplateDownload, getChatChannelAvatarDownload, getDocumentBatchExport, recordDocumentBatchExport, readStoredFile, log]) fn.mock.resetCalls();
    getCurrentSession.mock.mockImplementation(async () => member);
    for (const [, , lookup] of endpoints) lookup.mock.mockImplementation(async () => file);
    getDocumentBatchExport.mock.mockImplementation(async () => [file]);
    recordDocumentBatchExport.mock.mockImplementation(async () => {});
    readStoredFile.mock.mockImplementation(storage.readVerifiedDocumentFile);
  });
  for (const [name, handler, lookup, NotFound, limit] of endpoints) {
    await t.test(`${name}: authorization precedes file access`, async () => {
      getCurrentSession.mock.mockImplementation(async () => null);
      assert.equal((await send(handler)).status, 401);
      assert.equal(lookup.mock.callCount(), 0);
      getCurrentSession.mock.mockImplementation(async () => member);
      for (const [error, status] of [[new AuthorizationError(), 403], [new NotFound(), 404]]) {
        lookup.mock.mockImplementation(async () => { throw error; });
        assert.equal((await send(handler)).status, status);
      }
      assert.equal(readStoredFile.mock.callCount(), 0);
    });
    await t.test(`${name}: invalid size, checksum and file substitution fail closed`, async () => {
      const metadata = name === "preview" ? { ...file, mimeType: docxMime } : file;
      for (const patch of [{ sizeBytes: limit + 1 }, { sizeBytes: 0 }, { sizeBytes: -1 }, { sizeBytes: 1.5 }, { sizeBytes: bytes.length + 1 }, { sha256: "0".repeat(64) }, { sha256: "invalid" }]) {
        lookup.mock.mockImplementation(async () => ({ ...metadata, ...patch }));
        const response = await send(handler);
        assert.equal(response.status, 500);
        assert.equal((await response.text()).includes(directory), false);
      }
      lookup.mock.mockImplementation(async () => metadata);
      await writeFile(join(directory, file.storageKey), Buffer.alloc(bytes.length, "x"));
      try { assert.equal((await send(handler)).status, 500); }
      finally { await writeFile(join(directory, file.storageKey), bytes); }
      const missingKey = storage.createDocumentStorageKey(member.organizationId, randomUUID(), "pdf");
      lookup.mock.mockImplementation(async () => ({ ...metadata, storageKey: missingKey }));
      assert.equal((await send(handler)).status, 500);
      const linkKey = storage.createDocumentVersionStorageKey(member.organizationId, file.documentId, endpoints.findIndex(([entry]) => entry === name) + 2, "pdf");
      await symlink(join(directory, file.storageKey), join(directory, linkKey));
      lookup.mock.mockImplementation(async () => ({ ...metadata, storageKey: linkKey }));
      assert.equal((await send(handler)).status, 500);
      assert.equal(JSON.stringify(log.mock.calls).includes(directory), false);
      assert.ok(readStoredFile.mock.calls.every((call) => call.arguments[2] === limit));
    });
    if (name !== "preview") await t.test(`${name}: valid bytes retain private download headers`, async () => {
      const response = await send(handler);
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("content-length"), String(bytes.length));
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      if (name !== "avatar") assert.match(response.headers.get("content-disposition"), /filename\*=UTF-8''/);
      assert.equal(readStoredFile.mock.calls[0].arguments[2], limit);
    });
  }
  await t.test("preview parses a verified DOCX and escapes its text", async () => {
    const content = Buffer.from(zipSync({
      "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&lt;script&gt;private&lt;/script&gt;</w:t></w:r></w:p></w:body></w:document>'),
    }));
    const document = { ...file, filename: "Акт.docx", mimeType: docxMime, sizeBytes: content.length, sha256: createHash("sha256").update(content).digest("hex"), storageKey: storage.createDocumentStorageKey(member.organizationId, file.documentId, "docx") };
    await storage.writeDocumentFile(document.storageKey, content);
    getDocumentDownload.mock.mockImplementation(async () => document);
    const response = await send(preview);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /&lt;script&gt;private&lt;\/script&gt;/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  });
  await t.test("export denies access before any read or success audit", async () => {
    getCurrentSession.mock.mockImplementation(async () => null);
    assert.equal((await exportFiles()).status, 401);
    assert.equal(getDocumentBatchExport.mock.callCount(), 0);
    getCurrentSession.mock.mockImplementation(async () => member);
    for (const [error, status] of [[new AuthorizationError(), 403], [new DocumentNotFoundError(), 404]]) {
      getDocumentBatchExport.mock.mockImplementation(async () => { throw error; });
      assert.equal((await exportFiles()).status, status);
    }
    assert.equal(readStoredFile.mock.callCount(), 0);
    assert.equal(recordDocumentBatchExport.mock.callCount(), 0);
  });
  await t.test("export preflights the whole batch before any file allocation", async () => {
    getDocumentBatchExport.mock.mockImplementation(async () => Array.from({ length: 4 }, () => ({ ...file, sizeBytes: 15 * 1024 * 1024 })));
    assert.equal((await exportFiles()).status, 413);
    for (const sizeBytes of [NaN, -1, 0, 0.5, 16 * 1024 * 1024]) {
      getDocumentBatchExport.mock.mockImplementation(async () => [file, { ...file, sizeBytes }]);
      assert.equal((await exportFiles()).status, 500);
    }
    assert.equal(readStoredFile.mock.callCount(), 0);
    assert.equal(recordDocumentBatchExport.mock.callCount(), 0);
  });
  await t.test("export verifies every file and never audits a partial or failed archive", async () => {
    getDocumentBatchExport.mock.mockImplementation(async () => [file, { ...file, sha256: "0".repeat(64) }]);
    const corrupt = await exportFiles();
    assert.equal(corrupt.status, 500);
    assert.equal((await corrupt.json()).error.code, "file_integrity_error");
    assert.equal(recordDocumentBatchExport.mock.callCount(), 0);
    readStoredFile.mock.mockImplementation(async () => { throw new Error("private-storage-path-and-credentials"); });
    assert.equal((await exportFiles()).status, 500);
    assert.equal(JSON.stringify(log.mock.calls).includes("private-storage-path-and-credentials"), false);
    assert.equal(recordDocumentBatchExport.mock.callCount(), 0);
  });
  await t.test("export returns a verified ZIP and audits its actual byte total", async () => {
    const response = await exportFiles();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const entries = Object.values(unzipSync(new Uint8Array(await response.arrayBuffer())));
    assert.equal(entries.length, 1);
    assert.deepEqual(Buffer.from(entries[0]), bytes);
    assert.deepEqual(recordDocumentBatchExport.mock.calls[0].arguments, [member, [file], bytes.length]);
  });
});
