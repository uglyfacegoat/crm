import assert from "node:assert/strict";
import test from "node:test";
import { cancelTaskSchema, createTaskSchema, rescheduleTaskSchema, updateTaskSchema } from "./schemas.ts";

test("manual tasks accept either a complete local deadline or no deadline", () => {
  const base = { idempotencyKey: "5c24bda8-8e16-4f3a-bf11-67f7e383ecb9", title: "Подготовить акт", description: "", priority: "normal", assignedMemberId: "" };
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "", localTime: "" }).success, true);
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "2026-08-30", localTime: "09:15" }).success, true);
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "2026-08-30", localTime: "" }).success, false);
});

test("task editing validates assignment, deadline and optimistic version", () => {
  const input = {
    taskId: "dcd27a26-d907-45df-87b7-84e1a65fc058",
    expectedVersion: 3,
    title: "Проверить оплату",
    description: "Связаться с бухгалтерией клиента",
    priority: "high",
    assignedMemberId: "6af92aa6-f50a-453b-9640-e8f5c85c8077",
    localDate: "2026-09-01",
    localTime: "10:30",
  };
  assert.equal(updateTaskSchema.safeParse(input).success, true);
  assert.equal(updateTaskSchema.safeParse({ ...input, assignedMemberId: "unknown" }).success, false);
  assert.equal(updateTaskSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
});

test("task cancellation requires an auditable reason", () => {
  const input = { taskId: "dcd27a26-d907-45df-87b7-84e1a65fc058", expectedVersion: 2, reason: "Заказ отменён клиентом" };
  assert.equal(cancelTaskSchema.safeParse(input).success, true);
  assert.equal(cancelTaskSchema.safeParse({ ...input, reason: "  " }).success, false);
});

test("task rescheduling requires a persisted task version and known column", () => {
  const base = { taskId: "dcd27a26-d907-45df-87b7-84e1a65fc058", expectedVersion: 2 };
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, column: "today" }).success, true);
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, column: "archive" }).success, false);
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, expectedVersion: 0, column: "today" }).success, false);
});
