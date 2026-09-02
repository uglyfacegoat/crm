import assert from "node:assert/strict";
import test from "node:test";
import { selectCanonicalWebsiteMetrics, type WebsiteMetricRow } from "./metrics.ts";

const base = { websiteId: "site-1", date: "2026-09-01", sessions: 0, pageviews: 0, goalCompletions: 0, searchClicks: 0, searchImpressions: 0 };

test("traffic metrics choose one provider instead of double-counting analytics systems", () => {
  const rows: WebsiteMetricRow[] = [
    { ...base, provider: "ga4", visitors: 120 },
    { ...base, provider: "yandex_metrica", visitors: 100 },
  ];
  assert.deepEqual(selectCanonicalWebsiteMetrics(rows).traffic.map((row) => row.visitors), [100]);
});

test("search metrics combine different search engines", () => {
  const rows: WebsiteMetricRow[] = [
    { ...base, provider: "google_search_console", visitors: 0, searchClicks: 40 },
    { ...base, provider: "yandex_webmaster", visitors: 0, searchClicks: 60 },
  ];
  assert.equal(selectCanonicalWebsiteMetrics(rows).search.get("site-1:2026-09-01")?.clicks, 100);
});
