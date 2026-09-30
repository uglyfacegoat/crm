import assert from "node:assert/strict";
import test from "node:test";
import { getPreviewWebsiteDetail, getPreviewWebsiteSnapshot } from "./preview.ts";

test("website preview derives its thirty-day graph from the current date", () => {
  const snapshot = getPreviewWebsiteSnapshot(new Date("2026-09-18T08:00:00.000Z"));

  assert.deepEqual(snapshot.period, {
    startDate: "2026-08-20",
    endDate: "2026-09-18",
    timezone: "Europe/Moscow",
  });
  assert.equal(snapshot.trafficTrend.labels.length, 30);
  assert.match(snapshot.trafficTrend.labels[0] ?? "", /^20 авг/);
  assert.match(snapshot.trafficTrend.labels.at(-1) ?? "", /^18 сент/);
});

test("website health preview dates move with the active preview period", () => {
  const detail = getPreviewWebsiteDetail("site-1", new Date("2026-09-18T08:00:00.000Z"));

  assert.ok(detail);
  assert.equal(detail.healthHistory[0]?.measuredAt, "2026-09-18T11:20:00.000Z");
  assert.equal(detail.healthHistory.at(-1)?.measuredAt, "2026-08-23T11:20:00.000Z");
  assert.ok(detail.hosting);
  assert.equal(detail.hosting.renewalOn, "2026-10-03");
});
