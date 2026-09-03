import assert from "node:assert/strict";
import test from "node:test";
import { formatDateInput, formatIsoDateForInput, formatTimeInput, parseDateInput, parseTimeInput } from "./date-input.ts";

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

test("date and time display formatters keep persisted values human-readable", () => {
  assert.equal(formatIsoDateForInput("2026-09-03"), "03.09.2026");
  assert.equal(formatIsoDateForInput("03.09.2026"), "");
  assert.equal(formatTimeInput("1230"), "12:30");
  assert.equal(formatTimeInput("12:30"), "12:30");
});

test("parseTimeInput accepts only complete 24-hour values", () => {
  assert.equal(parseTimeInput("12:30"), "12:30");
  assert.equal(parseTimeInput("24:00"), null);
  assert.equal(parseTimeInput("12:60"), null);
  assert.equal(parseTimeInput("9:30"), null);
});
