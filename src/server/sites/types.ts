import type { ChartSeries } from "@/server/analytics/types";

export const websiteProviders = ["yandex_metrica", "ga4", "google_search_console", "yandex_webmaster"] as const;
export type WebsiteProvider = (typeof websiteProviders)[number];
export type WebsiteStatus = "setup" | "active" | "attention" | "disabled";
export type WebsiteIntegrationStatus = "pending" | "connected" | "error" | "revoked";
export type WebsiteHealthStatus = "healthy" | "degraded" | "down";

export type WebsiteIntegrationListItem = {
  id: string;
  provider: WebsiteProvider;
  propertyId: string;
  status: WebsiteIntegrationStatus;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
};

export type WebsiteListItem = {
  id: string;
  name: string;
  domain: string;
  status: WebsiteStatus;
  version: number;
  visitors: number;
  pageviews: number;
  leads: number;
  paidOrders: number;
  paidRevenueMinor: number;
  conversionPercent: number;
  integrations: WebsiteIntegrationListItem[];
};

export type WebsiteSnapshot = {
  period: { startDate: string; endDate: string; timezone: string };
  summary: {
    totalSites: number;
    activeSites: number;
    visitors: number;
    pageviews: number;
    searchClicks: number;
    leads: number;
    paidOrders: number;
    paidRevenueMinor: number;
    conversionPercent: number;
  };
  sites: WebsiteListItem[];
  trafficTrend: { labels: string[]; series: ChartSeries[] };
  trafficSources: Array<{ label: string; value: number; amount: number }>;
};

export type WebsiteHostingProfile = {
  provider: string;
  planName: string;
  serverRegion: string;
  monthlyCostMinor: number;
  renewalOn: string;
  sslExpiresOn: string;
  diskCapacityMb: number;
  memoryCapacityMb: number;
  notes: string | null;
};

export type WebsiteHealthSnapshot = {
  id: string;
  measuredAt: string;
  healthStatus: WebsiteHealthStatus;
  uptimePercent: number;
  responseTimeMs: number;
  cpuLoadPercent: number;
  memoryUsedMb: number;
  diskUsedMb: number;
  source: "manual" | "monitor";
};

export type WebsiteDetail = WebsiteListItem & {
  timezone: string;
  hosting: WebsiteHostingProfile | null;
  health: WebsiteHealthSnapshot | null;
  healthHistory: WebsiteHealthSnapshot[];
};
