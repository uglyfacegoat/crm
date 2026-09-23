import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(new URL("app/", root).href)) {
    if (specifier === "next/cache") return nextResolve("next/cache.js", context);
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
  }
  return nextResolve(specifier, context);
} });
const functions = Object.fromEntries([
  "completeVisitWithClosingDocument", "createAssignedVisitEvidence", "createVisit", "createVisitSeries", "rescheduleVisit",
  "startAssignedMasterVisit", "updateVisit", "visitCompletionExists", "visitEvidenceExists",
  "createDocumentTemplate", "documentTemplateExists", "updateDocumentTemplateStatus",
  "assertChatMessageAccess", "assertChatAvatarAccess", "chatMessageExists", "sendChatMessage", "updateChatChannelSettings",
  "createChatChannel", "createDirectChat", "markChatChannelRead", "toggleChatReaction", "toggleChatChannelPin", "updateChatChannelMembers",
].map((name) => [name, mock.fn()]));
const errors = Object.fromEntries([
  "VisitDuplicateError", "VisitClosingDocumentRequiredError", "VisitImmutableError", "VisitNotFoundError", "VisitReferenceError",
  "VisitRescheduleReasonRequiredError", "VisitScheduleConflictError", "VisitScheduleUnchangedError", "VisitStateTransitionError", "VisitVersionConflictError",
  "DocumentTemplateNotFoundError", "DocumentTemplateVersionConflictError",
  "ChatChannelConflictError", "ChatDirectConversationError", "ChatEntityUnavailableError", "ChatChannelNotFoundError",
  "ChatChannelVersionConflictError", "ChatGeneralChannelMutationError", "ChatMemberReferenceError",
].map((name) => [name, class extends Error {}]));
for (const domain of ["visits", "document-templates", "chat"]) {
  mock.module(new URL(`server/${domain}/repository.ts`, root), { namedExports: { ...functions, ...errors } });
}
const revalidatePath = mock.fn();
const writeDocumentFile = mock.fn();
const removeDocumentFile = mock.fn();
const FileWritesPausedError = class extends Error {};
const FileWriteLeaseLostError = class extends Error {};
const withFileWriteLease = mock.fn(async (operation) => operation());
mock.module("next/cache.js", { namedExports: { revalidatePath } });
mock.module(new URL("server/auth/config.ts", root), { namedExports: { getAuthMode: () => "required" } });
mock.module(new URL("server/auth/session.ts", root), { namedExports: { requireSession: async () => ({ organizationId: "test", memberId: "test" }) } });
mock.module(new URL("server/file-writes/gate.mjs", root), { namedExports: {
  FileWriteLeaseLostError, FileWritesPausedError, withFileWriteLease,
} });
mock.module(new URL("server/request-limits/repository.ts", root), { namedExports: { consumeRequestLimit: async () => ({ allowed: true }) } });
mock.module(new URL("server/documents/storage.ts", root), { namedExports: {
  writeDocumentFile, removeDocumentFile,
  createDocumentStorageKey: () => "upload", createDocumentTemplateStorageKey: () => "upload",
  createChatAttachmentStorageKey: () => "upload", createChatChannelAvatarStorageKey: () => "upload",
} });
const visits = await import("../src/app/(workspace)/calendar/actions.ts");
const templates = await import("../src/app/(workspace)/settings/template-actions.ts");
const chat = await import("../src/app/(workspace)/chat/actions.ts");
const previous = { status: "idle", message: null, fieldErrors: {}, entityId: null, documentId: null };
const id = "d81478c4-9807-44b4-befb-5819bbfbad22";
const pdf = Buffer.from("%PDF-1.4\nLifecycle test\n");
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test("remaining upload actions preserve committed and uncertain files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "crm-upload-lifecycle-"));
  const path = join(directory, "upload");
  const oldPath = join(directory, "previous-avatar");
  const log = mock.method(console, "error", () => {});
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await rm(directory, { recursive: true, force: true }); });
  t.beforeEach(async () => {
    await rm(path, { force: true });
    await writeFile(oldPath, png);
    for (const fn of [...Object.values(functions), revalidatePath, writeDocumentFile, removeDocumentFile, withFileWriteLease, log]) {
      fn.mock.resetCalls();
      fn.mock.mockImplementation(async () => undefined);
    }
    revalidatePath.mock.mockImplementation(() => {});
    withFileWriteLease.mock.mockImplementation(async (operation) => operation());
    functions.completeVisitWithClosingDocument.mock.mockImplementation(async () => ({ orderId: id, documentId: id }));
    functions.createAssignedVisitEvidence.mock.mockImplementation(async () => ({ orderId: id }));
    functions.sendChatMessage.mock.mockImplementation(async () => id);
    functions.updateChatChannelSettings.mock.mockImplementation(async () => ({ previousAvatarStorageKey: "previous-avatar" }));
    writeDocumentFile.mock.mockImplementation(async (_key, bytes) => writeFile(path, bytes, { flag: "wx" }));
    removeDocumentFile.mock.mockImplementation(async (key) => unlink(key === "previous-avatar" ? oldPath : path));
  });
  for (const [name, action, persist, image, refreshes, rejection] of [
    ["closing act", visits.completeVisitAction, functions.completeVisitWithClosingDocument, false, 6, new errors.VisitVersionConflictError()],
    ["visit photo", visits.uploadAssignedVisitEvidenceAction, functions.createAssignedVisitEvidence, true, 3, new errors.VisitImmutableError()],
    ["template", templates.uploadDocumentTemplateAction, functions.createDocumentTemplate, false, 2, new AuthorizationError()],
    ["chat attachment", chat.sendChatMessageAction, functions.sendChatMessage, false, 1, new errors.ChatEntityUnavailableError()],
    ["chat avatar", chat.updateChatChannelSettingsAction, functions.updateChatChannelSettings, true, 1, new errors.ChatChannelVersionConflictError()],
  ]) {
    function form() {
      const payload = new FormData();
      for (const [field, value] of Object.entries({
        idempotencyKey: id, visitId: id, channelId: id, expectedVersion: "1", actTitle: "Signed act",
        completionNotes: "Work complete", kind: "work_photo", note: "", title: "Approved template", description: "",
        body: "Message with attachment", name: "Test group",
      })) payload.set(field, value);
      payload.set(name === "chat avatar" ? "avatar" : "file", new File([image ? png : pdf], image ? "image.png" : "file.pdf", { type: image ? "image/png" : "application/pdf" }));
      return payload;
    }
    await t.test(`${name}: normal commit retains owned bytes`, async () => {
      const result = await action(previous, form());
      assert.equal(result.status, "success", result.message);
      assert.equal(result.refreshRequired, undefined);
      assert.deepEqual(await readFile(path), image ? png : pdf);
      if (name === "chat avatar") await assert.rejects(readFile(oldPath), { code: "ENOENT" });
    });
    for (let failAt = 1; failAt <= refreshes; failAt += 1) {
      await t.test(`${name}: refresh failure ${failAt} reports committed state`, async () => {
        let count = 0;
        revalidatePath.mock.mockImplementation(() => { if (++count === failAt) throw new Error("Cache unavailable"); });
        const result = await action(previous, form());
        assert.equal(result.status, "success", result.message);
        assert.equal(result.refreshRequired, true);
        assert.match(result.message, /Обновите/);
        assert.deepEqual(await readFile(path), image ? png : pdf);
        assert.equal(log.mock.callCount(), 1);
      });
    }
    await t.test(`${name}: known transaction rejection removes only owned bytes`, async () => {
      persist.mock.mockImplementation(async () => { throw rejection; });
      assert.equal((await action(previous, form())).status, "error");
      await assert.rejects(readFile(path), { code: "ENOENT" });
      assert.deepEqual(await readFile(oldPath), png);
      assert.equal(removeDocumentFile.mock.callCount(), 1);
    });
    await t.test(`${name}: unknown transaction outcome retains evidence`, async () => {
      persist.mock.mockImplementation(async () => { throw Object.assign(new Error("Connection lost"), { code: "CONNECTION_CLOSED" }); });
      const result = await action(previous, form());
      assert.equal(result.status, "error");
      assert.match(result.message, /Не удалось подтвердить/);
      assert.deepEqual(await readFile(path), image ? png : pdf);
      assert.deepEqual(await readFile(oldPath), png);
      assert.equal(removeDocumentFile.mock.callCount(), 0);
    });
    await t.test(`${name}: existing file is never adopted or deleted`, async () => {
      await writeFile(path, "Other request owns these bytes");
      assert.equal((await action(previous, form())).status, "error");
      assert.equal(persist.mock.callCount(), 0);
      assert.equal(removeDocumentFile.mock.callCount(), 0);
      assert.equal(await readFile(path, "utf8"), "Other request owns these bytes");
    });
  }
  for (const [name, action, fileField, image] of [
    ["closing act", visits.completeVisitAction, "file", false],
    ["visit photo", visits.uploadAssignedVisitEvidenceAction, "file", true],
    ["template", templates.uploadDocumentTemplateAction, "file", false],
    ["chat attachment", chat.sendChatMessageAction, "file", false],
    ["chat avatar", chat.updateChatChannelSettingsAction, "avatar", true],
  ]) {
    await t.test(`${name}: paused writes reject before storage`, async () => {
      withFileWriteLease.mock.mockImplementation(async () => { throw new FileWritesPausedError(); });
      const payload = new FormData();
      payload.set(fileField, new File([image ? png : pdf], image ? "image.png" : "file.pdf", { type: image ? "image/png" : "application/pdf" }));
      const result = await action(previous, payload);
      assert.equal(result.status, "error");
      assert.match(result.message, /временно остановлена/);
      assert.equal(writeDocumentFile.mock.callCount(), 0);
    });
  }
});
