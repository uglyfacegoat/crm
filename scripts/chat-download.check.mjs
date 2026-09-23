import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mock, test } from "node:test";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
  return nextResolve(specifier, context);
} });
mock.module("server-only", { namedExports: {} });
const storageUrl = new URL("server/documents/storage.ts", root);
const storage = await import(storageUrl.href);
const readFile = mock.fn(storage.readVerifiedDocumentFile);
mock.module(storageUrl, { namedExports: { readVerifiedDocumentFile: readFile, StoredFileIntegrityError: storage.StoredFileIntegrityError } });
const getCurrentSession = mock.fn();
const getChatAttachmentDownload = mock.fn();
const recordChatAttachmentDownload = mock.fn();
const consumeRequestLimit = mock.fn();
class ChatChannelNotFoundError extends Error {}
mock.module(new URL("server/auth/session.ts", root), { namedExports: { getCurrentSession } });
mock.module(new URL("server/chat/repository.ts", root), { namedExports: { getChatAttachmentDownload, recordChatAttachmentDownload, ChatChannelNotFoundError } });
mock.module(new URL("server/request-limits/repository.ts", root), { namedExports: { consumeRequestLimit } });
const { GET, HEAD } = await import("../src/app/api/v1/chat/attachments/[id]/download/route.ts");

test("chat download preserves authorization, range semantics and bounded integrity checks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "crm-download-test-"));
  const previousRoot = process.env.DOCUMENT_STORAGE_ROOT;
  process.env.DOCUMENT_STORAGE_ROOT = directory;
  const log = mock.method(console, "error", () => {});
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.DOCUMENT_STORAGE_ROOT;
    else process.env.DOCUMENT_STORAGE_ROOT = previousRoot;
    mock.restoreAll(); hooks.deregister();
    await rm(directory, { recursive: true });
  });
  const bytes = Buffer.from("0123456789");
  const member = { memberId: randomUUID(), organizationId: randomUUID() };
  const attachment = { id: randomUUID(), filename: "запись.wav", mimeType: "audio/wav", sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  attachment.storageKey = storage.createChatAttachmentStorageKey(member.organizationId, attachment.id, "wav");
  const fixturePath = join(directory, attachment.storageKey);
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, bytes, { flag: "wx" });
  const context = { params: Promise.resolve({ id: attachment.id }) };
  const send = (headers = {}, method = "GET") => (method === "HEAD" ? HEAD : GET)(new Request("http://localhost/file", { headers, method }), context);
  t.beforeEach(() => {
    for (const fn of [getCurrentSession, getChatAttachmentDownload, recordChatAttachmentDownload, consumeRequestLimit, readFile, log]) fn.mock.resetCalls();
    getCurrentSession.mock.mockImplementation(async () => member);
    getChatAttachmentDownload.mock.mockImplementation(async () => attachment);
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: true, retryAfterSeconds: 60 }));
    recordChatAttachmentDownload.mock.mockImplementation(async () => {});
  });
  await t.test("anonymous and unauthorized requests never consume budgets or access files", async () => {
    getCurrentSession.mock.mockImplementation(async () => null);
    assert.equal((await send({ range: "bytes=0-1" })).status, 401);
    assert.equal(getChatAttachmentDownload.mock.callCount(), 0);
    getCurrentSession.mock.mockImplementation(async () => member);
    for (const [error, status] of [[new AuthorizationError(), 403], [new ChatChannelNotFoundError(), 404]]) {
      getChatAttachmentDownload.mock.mockImplementation(async () => { throw error; });
      assert.equal((await send({ range: "bytes=0-1" })).status, status);
    }
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(recordChatAttachmentDownload.mock.callCount(), 0);
  });
  await t.test("quota denial and storage failure fail closed before file reads or successful audit", async () => {
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: false, retryAfterSeconds: 12 }));
    const denied = await send();
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get("retry-after"), "12");
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    consumeRequestLimit.mock.mockImplementation(async () => { throw new Error("private database details"); });
    const unavailable = await send();
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.text()).includes("private database"), false);
    assert.equal(readFile.mock.callCount(), 0);
    assert.equal(recordChatAttachmentDownload.mock.callCount(), 0);
  });
  await t.test("full and partial responses have exact bytes, lengths and safe private headers", async () => {
    for (const [range, expected, status, contentRange] of [[null, "0123456789", 200, null], ["bytes=0-0", "0", 206, "bytes 0-0/10"], ["bytes=4-", "456789", 206, "bytes 4-9/10"], ["bytes=-3", "789", 206, "bytes 7-9/10"]]) {
      const response = await send(range ? { range } : {});
      assert.equal(response.status, status);
      assert.equal(await response.text(), expected);
      assert.equal(response.headers.get("content-length"), String(expected.length));
      assert.equal(response.headers.get("content-range"), contentRange);
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("content-disposition"), /^inline;.*filename\*=UTF-8''/);
    }
    assert.equal(recordChatAttachmentDownload.mock.callCount(), 4);
  });
  await t.test("unsatisfiable ranges and HEAD do not create downloaded audit events", async () => {
    const invalid = await send({ range: "bytes=100-" });
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */10");
    assert.equal(await invalid.text(), "");
    const head = await send({ range: "bytes=1-3" }, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-length"), "10");
    assert.equal(head.headers.get("content-range"), null);
    assert.equal(recordChatAttachmentDownload.mock.callCount(), 0);
  });
  await t.test("If-Range uses a strong checksum validator and conditional reads retain authorization", async () => {
    const etag = `"${attachment.sha256}"`;
    assert.equal((await send({ range: "bytes=1-3", "if-range": etag })).status, 206);
    for (const validator of ["W/" + etag, '"stale"', "Wed, 01 Jan 2020 00:00:00 GMT"]) {
      assert.equal(await (await send({ range: "bytes=1-3", "if-range": validator })).text(), "0123456789");
    }
    assert.equal((await send({ "if-none-match": "W/" + etag })).status, 304);
    assert.equal((await send({ "if-match": '"stale"' })).status, 412);
  });
  await t.test("a corrupted file is rejected even when the requested slice is unchanged", async () => {
    await writeFile(join(directory, attachment.storageKey), "012345678X");
    try {
      const response = await send({ range: "bytes=0-1" });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: "file_integrity_error" });
      assert.equal(recordChatAttachmentDownload.mock.callCount(), 0);
    } finally { await writeFile(join(directory, attachment.storageKey), bytes); }
  });
  await t.test("reader rejects size mismatches, oversized metadata and symlinks", async () => {
    await assert.rejects(storage.readVerifiedDocumentFile(attachment.storageKey, { ...attachment, sizeBytes: 11 }, 100), storage.StoredFileIntegrityError);
    await assert.rejects(storage.readVerifiedDocumentFile(attachment.storageKey, attachment, 9), storage.StoredFileIntegrityError);
    const linkKey = storage.createChatAttachmentStorageKey(member.organizationId, attachment.id, "pdf");
    await symlink(join(directory, attachment.storageKey), join(directory, linkKey));
    await assert.rejects(storage.readVerifiedDocumentFile(linkKey, attachment, 100), { code: "ELOOP" });
  });
});
