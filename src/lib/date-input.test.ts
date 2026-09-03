import assert from "node:assert/strict";
import test from "node:test";
import { formatDateInput, parseDateInput } from "./date-input.ts";

test("formatDateInput adds separators while typing", () => {
  assert.equal(formatDateInput("03092026"), "03.09.2026");
  assert.equal(formatDateInput("03.09"), "03.09");
  assert.equal(formatDateInput("03-09-2026"), "03.09.2026");
});

test("parseDateInput returns an ISO date only for valid calendar dates", () => {
  assert.equal(parseDateInput("03.09.2026"), "2026-09-03");
  assert.equal(parseDateInput("31.02.2026"), null);
  assert.equal(parseDateInput("3.9.2026"), null);
  assert.equal(parseDateInput(""), null);
});
