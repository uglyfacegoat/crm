import assert from "node:assert/strict";
import test from "node:test";
import { createChatChannelSchema, createDirectChatSchema, sendChatMessageSchema, toggleChatReactionSchema, updateChatChannelMembersSchema, updateChatChannelSettingsSchema } from "./schemas.ts";

test("group input trims fields and removes duplicate members", () => {
  const memberId = "00000000-0000-4000-8000-000000000002";
  const parsed = createChatChannelSchema.parse({
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    name: "  Оперативный штаб  ",
    description: "  Срочные вопросы  ",
    memberIds: [memberId, memberId],
  });
  assert.equal(parsed.name, "Оперативный штаб");
  assert.equal(parsed.memberIds.length, 1);
});

test("message input rejects empty and oversized messages", () => {
  const base = { idempotencyKey: "00000000-0000-4000-8000-000000000001", channelId: "00000000-0000-4000-8000-000000000002" };
  assert.equal(sendChatMessageSchema.safeParse({ ...base, body: "   " }).success, false);
  assert.equal(sendChatMessageSchema.safeParse({ ...base, body: "x".repeat(4001) }).success, false);
});

test("message input accepts a permitted CRM entity without comment", () => {
  const parsed = sendChatMessageSchema.parse({
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    channelId: "00000000-0000-4000-8000-000000000002",
    body: "",
    sharedEntityType: "order",
    sharedEntityId: "00000000-0000-4000-8000-000000000003",
  });
  assert.equal(parsed.sharedEntityType, "order");
  assert.equal(sendChatMessageSchema.safeParse({ ...parsed, sharedEntityId: undefined }).success, false);
});

test("direct chat input requires an idempotency key and target member", () => {
  const parsed = createDirectChatSchema.parse({ idempotencyKey: "00000000-0000-4000-8000-000000000001", targetMemberId: "00000000-0000-4000-8000-000000000002" });
  assert.equal(parsed.targetMemberId, "00000000-0000-4000-8000-000000000002");
});

test("membership update deduplicates users and requires a channel version", () => {
  const memberId = "00000000-0000-4000-8000-000000000002";
  const parsed = updateChatChannelMembersSchema.parse({ channelId: "00000000-0000-4000-8000-000000000003", expectedVersion: 4, memberIds: [memberId, memberId] });
  assert.deepEqual(parsed.memberIds, [memberId]);
  assert.equal(updateChatChannelMembersSchema.safeParse({ channelId: parsed.channelId, expectedVersion: 0, memberIds: [] }).success, false);
});

test("channel settings parse a checkbox value without weakening other fields", () => {
  const parsed = updateChatChannelSettingsSchema.parse({
    channelId: "00000000-0000-4000-8000-000000000003",
    expectedVersion: "2",
    name: "  Выездная команда  ",
    description: "",
    muted: "on",
  });
  assert.equal(parsed.name, "Выездная команда");
  assert.equal(parsed.description, null);
  assert.equal(parsed.muted, true);
});

test("message reactions only accept the supported emoji set", () => {
  const messageId = "00000000-0000-4000-8000-000000000004";
  assert.equal(toggleChatReactionSchema.safeParse({ messageId, emoji: "🔥" }).success, true);
  assert.equal(toggleChatReactionSchema.safeParse({ messageId, emoji: "🚀" }).success, true);
  assert.equal(toggleChatReactionSchema.safeParse({ messageId, emoji: "not-an-emoji" }).success, false);
});
