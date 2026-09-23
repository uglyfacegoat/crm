import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const actionUrl = new URL("../src/app/(workspace)/chat/actions.ts", import.meta.url);
const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === actionUrl.href && specifier === "next/cache") {
      return nextResolve("next/cache.js", context);
    }
    if (context.parentURL === actionUrl.href && specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const member = { organizationId: "b8b990ca-763c-4d7e-a2c3-e4135d481d55", memberId: "db18bd2f-764b-4ed5-a797-0714917b53a5" };
const events = [];
const functions = Object.fromEntries([
  "assertChatMessageAccess", "assertChatAvatarAccess", "chatMessageExists", "sendChatMessage", "updateChatChannelSettings",
  "createChatChannel", "createDirectChat", "markChatChannelRead", "toggleChatReaction", "toggleChatChannelPin", "updateChatChannelMembers",
].map((name) => [name, mock.fn()]));
const errors = Object.fromEntries([
  "ChatChannelConflictError", "ChatDirectConversationError", "ChatEntityUnavailableError", "ChatChannelNotFoundError",
  "ChatChannelVersionConflictError", "ChatGeneralChannelMutationError", "ChatMemberReferenceError",
].map((name) => [name, class extends Error {}]));
const consumeRequestLimit = mock.fn();
const writeDocumentFile = mock.fn();
const removeDocumentFile = mock.fn();
mock.module("next/cache.js", { namedExports: { revalidatePath: mock.fn() } });
mock.module(new URL("server/auth/config.ts", sourceRoot), { namedExports: { getAuthMode: () => "required" } });
mock.module(new URL("server/auth/session.ts", sourceRoot), { namedExports: { requireSession: async () => member } });
mock.module(new URL("server/file-writes/gate.mjs", sourceRoot), { namedExports: {
  FileWriteLeaseLostError: class extends Error {},
  FileWritesPausedError: class extends Error {},
  withFileWriteLease: async (operation) => operation(),
} });
mock.module(new URL("server/chat/repository.ts", sourceRoot), { namedExports: { ...functions, ...errors } });
mock.module(new URL("server/request-limits/repository.ts", sourceRoot), { namedExports: { consumeRequestLimit } });
mock.module(new URL("server/documents/storage.ts", sourceRoot), { namedExports: {
  writeDocumentFile, removeDocumentFile,
  createChatAttachmentStorageKey: () => "test-attachment-key",
  createChatChannelAvatarStorageKey: () => "test-avatar-key",
} });
const { sendChatMessageAction, updateChatChannelSettingsAction } = await import(actionUrl.href);
const previous = { status: "idle", message: null, fieldErrors: {}, entityId: null };

function form(avatar = false) {
  const formData = new FormData();
  formData.set("channelId", "0204d5c0-b81f-474c-9ef7-21c584eb5301");
  formData.set("idempotencyKey", "1866b7e7-8cb4-4c8a-a23d-3a9f09ac0e6a");
  formData.set("body", "Draft preserved");
  if (avatar) {
    formData.set("expectedVersion", "1");
    formData.set("name", "Test group");
    formData.set("description", "");
  }
  const file = new File([avatar ? Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) : "%PDF-1.4\n"], avatar ? "avatar.png" : "attachment.pdf", { type: avatar ? "image/png" : "application/pdf" });
  const read = mock.method(file, "arrayBuffer");
  formData.set(avatar ? "avatar" : "file", file);
  return { formData, file, read };
}

test("chat actions authorize and throttle before attachment reads/writes", async (t) => {
  t.beforeEach(() => {
    events.length = 0;
    for (const fn of [...Object.values(functions), consumeRequestLimit, writeDocumentFile, removeDocumentFile]) fn.mock.resetCalls();
    functions.assertChatMessageAccess.mock.mockImplementation(async () => { events.push("access"); });
    functions.assertChatAvatarAccess.mock.mockImplementation(async () => { events.push("avatar-access"); });
    functions.chatMessageExists.mock.mockImplementation(async () => { events.push("existing"); return false; });
    consumeRequestLimit.mock.mockImplementation(async (_member, operation) => { events.push(operation); return { allowed: true, retryAfterSeconds: 60 }; });
    writeDocumentFile.mock.mockImplementation(async () => { events.push("write"); });
    functions.sendChatMessage.mock.mockImplementation(async (_member, input) => { events.push("send"); return input.idempotencyKey; });
    functions.updateChatChannelSettings.mock.mockImplementation(async () => ({ previousAvatarStorageKey: null }));
  });
  for (const operation of ["chat_message", "chat_upload"]) {
    await t.test(`${operation} denial does not read or persist the attachment`, async () => {
      const fixture = form();
      consumeRequestLimit.mock.mockImplementation(async (_member, key) => ({ allowed: key !== operation, retryAfterSeconds: 40 }));
      const result = await sendChatMessageAction(previous, fixture.formData);
      assert.equal(result.status, "error");
      assert.match(result.message, /40 сек.*Черновик сохранён/);
      assert.equal(fixture.read.mock.callCount(), 0);
      assert.equal(writeDocumentFile.mock.callCount(), 0);
      assert.equal(functions.sendChatMessage.mock.callCount(), 0);
    });
  }
  await t.test("unauthorized channel fails before budgets and file access", async () => {
    const fixture = form();
    functions.assertChatMessageAccess.mock.mockImplementation(async () => { throw new errors.ChatChannelNotFoundError(); });
    assert.equal((await sendChatMessageAction(previous, fixture.formData)).status, "error");
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
    assert.equal(fixture.read.mock.callCount(), 0);
    assert.equal(writeDocumentFile.mock.callCount(), 0);
  });
  await t.test("confirmed duplicate succeeds even when budgets are exhausted, without another upload", async () => {
    const fixture = form();
    functions.chatMessageExists.mock.mockImplementation(async () => true);
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: false, retryAfterSeconds: 60 }));
    assert.equal((await sendChatMessageAction(previous, fixture.formData)).status, "success");
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
    assert.equal(fixture.read.mock.callCount(), 0);
    assert.equal(writeDocumentFile.mock.callCount(), 0);
  });
  await t.test("authorized upload follows access, idempotency and budget checks", async () => {
    const fixture = form();
    assert.equal((await sendChatMessageAction(previous, fixture.formData)).status, "success");
    assert.deepEqual(events, ["access", "existing", "chat_message", "chat_upload", "write", "send"]);
    assert.equal(fixture.read.mock.callCount(), 1);
  });
  await t.test("metadata size rejection happens before allocating an attachment buffer", async () => {
    const fixture = form();
    mock.getter(fixture.file, "size", () => 15 * 1024 * 1024 + 1);
    assert.match((await sendChatMessageAction(previous, fixture.formData)).message, /15 МБ/);
    assert.equal(fixture.read.mock.callCount(), 0);
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
  });
  await t.test("avatar permission and upload limits precede file I/O", async () => {
    const fixture = form(true);
    functions.assertChatAvatarAccess.mock.mockImplementation(async () => { throw new AuthorizationError(); });
    assert.match((await updateChatChannelSettingsAction(previous, fixture.formData)).message, /Недостаточно прав/);
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
    functions.assertChatAvatarAccess.mock.mockImplementation(async () => {});
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: false, retryAfterSeconds: 20 }));
    assert.match((await updateChatChannelSettingsAction(previous, fixture.formData)).message, /20 сек/);
    assert.equal(fixture.read.mock.callCount(), 0);
    assert.equal(writeDocumentFile.mock.callCount(), 0);
    assert.equal(functions.updateChatChannelSettings.mock.callCount(), 0);
  });
  t.after(() => { mock.restoreAll(); hooks.deregister(); });
});
