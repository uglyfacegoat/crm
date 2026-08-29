import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsBuckets, describeChange } from "./calculations.ts";

test("describeChange handles growth, decline and a missing comparison base", () => {
  assert.equal(describeChange(120, 100), "+20%");
  assert.equal(describeChange(80, 100), "−20%");
  assert.equal(describeChange(15, 0), "Новый показатель");
  assert.equal(describeChange(0, 0), "Без изменений");
});

test("createAnalyticsBuckets fills daily, weekly and monthly periods", () => {
  assert.equal(createAnalyticsBuckets("2026-08-01", "2026-08-30", 30).length, 30);
  assert.equal(createAnalyticsBuckets("2026-06-02", "2026-08-30", 90)[0].key, "2026-06-01");
  assert.equal(createAnalyticsBuckets("2025-08-31", "2026-08-30", 365).length, 13);
});
