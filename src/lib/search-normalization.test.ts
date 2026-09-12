import assert from "node:assert/strict";
import test from "node:test";
import { getSearchTokens, matchesSearchText, normalizeSearchText } from "./search-normalization.ts";

test("search normalization treats quote variants, punctuation, case, and ё as equivalent", () => {
  assert.equal(normalizeSearchText('ООО «Ёлка», склад №12'), "ооо елка склад 12");
  assert.deepEqual(getSearchTokens('  ООО "Ёлка"  '), ["ооо", "елка"]);
});

test("smart text matching accepts partial tokens in any order", () => {
  assert.equal(matchesSearchText('ООО "Мобильный', ['ООО «Мобильный поток 126142»']), true);
  assert.equal(matchesSearchText('поток ооо', ['ООО «Мобильный поток 126142»']), true);
  assert.equal(matchesSearchText('мобильный несуществующий', ['ООО «Мобильный поток 126142»']), false);
});

test("smart text matching keeps compact phone fragment lookup", () => {
  assert.equal(matchesSearchText('99911122', ['Алексей Петров', '+7 (999) 111-22-33']), true);
});
