import assert from "node:assert/strict";
import test from "node:test";
import { createTaskSchema, rescheduleTaskSchema } from "./schemas.ts";

test("manual tasks accept either a complete local deadline or no deadline", () => {
  const base = { idempotencyKey: "5c24bda8-8e16-4f3a-bf11-67f7e383ecb9", title: "Подготовить акт", description: "", priority: "normal" };
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "", localTime: "" }).success, true);
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "2026-08-30", localTime: "09:15" }).success, true);
  assert.equal(createTaskSchema.safeParse({ ...base, localDate: "2026-08-30", localTime: "" }).success, false);
});

test("task rescheduling requires a persisted task version and known column", () => {
  const base = { taskId: "dcd27a26-d907-45df-87b7-84e1a65fc058", expectedVersion: 2 };
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, column: "today" }).success, true);
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, column: "archive" }).success, false);
  assert.equal(rescheduleTaskSchema.safeParse({ ...base, expectedVersion: 0, column: "today" }).success, false);
});
