import type { WebsiteProvider } from "./types";

export type WebsiteMetricRow = {
  websiteId: string;
  date: string;
  provider: WebsiteProvider | "crm";
  visitors: number;
  sessions: number;
  pageviews: number;
  goalCompletions: number;
  searchClicks: number;
  searchImpressions: number;
};

const trafficPriority: ReadonlyArray<WebsiteMetricRow["provider"]> = ["yandex_metrica", "ga4", "crm"];

export function selectCanonicalWebsiteMetrics(rows: WebsiteMetricRow[]) {
  const trafficBySiteAndDate = new Map<string, WebsiteMetricRow>();
  const searchBySiteAndDate = new Map<string, { clicks: number; impressions: number }>();
  for (const row of rows) {
    const key = `${row.websiteId}:${row.date}`;
    if (trafficPriority.includes(row.provider)) {
      const current = trafficBySiteAndDate.get(key);
      if (!current || trafficPriority.indexOf(row.provider) < trafficPriority.indexOf(current.provider)) trafficBySiteAndDate.set(key, row);
    }
    if (row.provider === "google_search_console" || row.provider === "yandex_webmaster") {
      const current = searchBySiteAndDate.get(key) ?? { clicks: 0, impressions: 0 };
      searchBySiteAndDate.set(key, { clicks: current.clicks + row.searchClicks, impressions: current.impressions + row.searchImpressions });
    }
  }
  return { traffic: [...trafficBySiteAndDate.values()], search: searchBySiteAndDate };
}
