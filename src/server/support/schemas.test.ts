import assert from "node:assert/strict";
import test from "node:test";
import { createSupportRequestSchema, updateSupportRequestStatusSchema } from "./schemas.ts";

test("support request requires an actionable description", () => {
  const valid = createSupportRequestSchema.safeParse({
    idempotencyKey: crypto.randomUUID(),
    category: "technical",
    subject: "Не открывается карточка заказа",
    description: "После выбора заказа появляется сообщение об ошибке. Повторяется в Chrome.",
  });
  assert.equal(valid.success, true);
  assert.equal(createSupportRequestSchema.safeParse({ ...valid.data, description: "Не работает" }).success, false);
});

test("support ticket status update requires optimistic concurrency", () => {
  const valid = updateSupportRequestStatusSchema.safeParse({
    requestId: crypto.randomUUID(),
    expectedVersion: 1,
    status: "in_progress",
  });
  assert.equal(valid.success, true);
  assert.equal(updateSupportRequestStatusSchema.safeParse({ ...valid.data, expectedVersion: 0 }).success, false);
  assert.equal(updateSupportRequestStatusSchema.safeParse({ ...valid.data, status: "unknown" }).success, false);
});
