import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewAnalytics } from "./preview.ts";

test("preview analytics derives chart dates from the selected period", () => {
  const snapshot = getPreviewAnalytics(30, new Date("2026-09-18T08:00:00.000Z"));

  assert.deepEqual(snapshot.range, {
    days: 30,
    startDate: "2026-08-20",
    endDate: "2026-09-18",
    timezone: "Europe/Moscow",
  });
  assert.equal(snapshot.financialTrend.labels.length, 8);
  assert.match(snapshot.financialTrend.labels[0] ?? "", /^20 авг/);
  assert.match(snapshot.financialTrend.labels.at(-1) ?? "", /^18 сент/);
  assert.equal(snapshot.visitActivity[0]?.key, "2026-08-20");
  assert.equal(snapshot.visitActivity.at(-1)?.key, "2026-09-18");
});

test("preview analytics includes years when a range crosses a year boundary", () => {
  const snapshot = getPreviewAnalytics(365, new Date("2026-02-01T08:00:00.000Z"));

  assert.match(snapshot.financialTrend.labels[0] ?? "", /2025/);
  assert.match(snapshot.financialTrend.labels.at(-1) ?? "", /2026/);
});
