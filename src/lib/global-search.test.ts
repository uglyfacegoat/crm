import assert from "node:assert/strict";
import test from "node:test";
import { escapeSearchPattern, getSearchDigits, globalSearchQuerySchema, parseSearchDate } from "./global-search.ts";

test("global search normalizes whitespace and enforces useful query length", () => {
  assert.equal(globalSearchQuerySchema.parse("  ООО   Вектор  "), "ООО Вектор");
  assert.equal(globalSearchQuerySchema.safeParse(" а ").success, false);
  assert.equal(globalSearchQuerySchema.safeParse("x".repeat(101)).success, false);
});

test("global search recognizes valid ISO and Russian dates", () => {
  assert.equal(parseSearchDate("31.08.2026"), "2026-08-31");
  assert.equal(parseSearchDate("2026-02-28"), "2026-02-28");
  assert.equal(parseSearchDate("31.02.2026"), null);
  assert.equal(parseSearchDate("31.08"), null);
});

test("global search escapes SQL LIKE metacharacters", () => {
  assert.equal(escapeSearchPattern("100%_готов\\о"), "100\\%\\_готов\\\\о");
});

test("global search extracts a meaningful phone fragment", () => {
  assert.equal(getSearchDigits("+7 (999) 123-45-67"), "79991234567");
  assert.equal(getSearchDigits("№12"), null);
});
