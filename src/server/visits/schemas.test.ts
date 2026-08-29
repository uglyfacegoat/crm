import assert from "node:assert/strict";
import test from "node:test";
import { rescheduleVisitSchema } from "./schemas.ts";

test("visit rescheduling accepts a versioned 15-minute schedule target", () => {
  const input = { visitId: "69166619-057f-459d-861d-4fbcb4a144ab", expectedVersion: 3, localDate: "2026-08-31", localTime: "13:15" };
  assert.equal(rescheduleVisitSchema.safeParse(input).success, true);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, localTime: "25:00" }).success, false);
});
