import assert from "node:assert/strict";
import test from "node:test";
import { createChatChannelSchema, sendChatMessageSchema } from "./schemas.ts";

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
