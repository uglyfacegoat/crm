import test from "node:test";
import assert from "node:assert/strict";
import { generateVisitRecurrenceDates } from "./recurrence.ts";

test("generates weekly visits through the inclusive end date", () => {
  assert.deepEqual(generateVisitRecurrenceDates("2026-01-05", "2026-02-02", "week", 2), ["2026-01-05", "2026-01-19", "2026-02-02"]);
});

test("monthly visits preserve the anchor day and clamp short months", () => {
  assert.deepEqual(generateVisitRecurrenceDates("2026-01-31", "2026-04-30", "month", 1), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
});

test("rejects an invalid range instead of silently returning no visits", () => {
  assert.throws(() => generateVisitRecurrenceDates("2026-02-01", "2026-01-01", "week", 1), RangeError);
});
