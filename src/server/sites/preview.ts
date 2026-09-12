import type { WebsiteDetail, WebsiteSnapshot } from "./types";

export function getPreviewWebsiteSnapshot(): WebsiteSnapshot {
  const sites = [
    { id: "site-1", name: "Городская дезслужба", domain: "dez-control.ru", status: "active" as const, version: 1, visitors: 18_420, pageviews: 34_860, leads: 286, paidOrders: 47, paidRevenueMinor: 11_750_000, conversionPercent: 1.55, integrations: [] },
    { id: "site-2", name: "Контроль грызунов", domain: "stop-rodent.ru", status: "active" as const, version: 1, visitors: 9_870, pageviews: 22_184, leads: 194, paidOrders: 31, paidRevenueMinor: 7_920_000, conversionPercent: 1.97, integrations: [] },
    { id: "site-3", name: "Утилизация для бизнеса", domain: "eco-util.ru", status: "attention" as const, version: 1, visitors: 4_630, pageviews: 11_191, leads: 61, paidOrders: 8, paidRevenueMinor: 2_160_000, conversionPercent: 1.32, integrations: [] },
    { id: "site-4", name: "Новый региональный сайт", domain: "podolsk-dez.ru", status: "setup" as const, version: 1, visitors: 0, pageviews: 0, leads: 0, paidOrders: 0, paidRevenueMinor: 0, conversionPercent: 0, integrations: [] },
  ];
  return {
    period: { startDate: "2026-08-04", endDate: "2026-09-02", timezone: "Europe/Moscow" },
    summary: { totalSites: 4, activeSites: 2, visitors: 32_920, pageviews: 68_235, searchClicks: 8_420, leads: 541, paidOrders: 86, paidRevenueMinor: 21_830_000, conversionPercent: 1.64 },
    sites,
    trafficTrend: { labels: ["04 авг", "09 авг", "14 авг", "19 авг", "24 авг", "29 авг", "02 сен"], series: [
      { label: "Посетители", color: "#000000", values: [3210, 3880, 3560, 4210, 4890, 5560, 5910] },
      { label: "Просмотры", color: "#a2beff", values: [6820, 7310, 7010, 8420, 9630, 10820, 11240] },
      { label: "Поисковые клики", color: "#25272c", values: [710, 840, 790, 980, 1120, 1270, 1390] },
    ] },
    trafficSources: [
      { label: "Органический поиск", value: 46, amount: 249 },
      { label: "Реклама", value: 28, amount: 151 },
      { label: "Прямые заходы", value: 17, amount: 92 },
      { label: "Карты и каталоги", value: 9, amount: 49 },
    ],
  };
}

export function getPreviewWebsiteDetail(websiteId: string): WebsiteDetail | null {
  const site = getPreviewWebsiteSnapshot().sites.find((entry) => entry.id === websiteId);
  if (!site) return null;
  const healthHistory = [
    { id: "health-1", measuredAt: "2026-09-02T15:40:00.000Z", healthStatus: "healthy" as const, uptimePercent: 99.98, responseTimeMs: 184, cpuLoadPercent: 37.2, memoryUsedMb: 4096, diskUsedMb: 38_400, source: "monitor" as const },
    { id: "health-2", measuredAt: "2026-09-02T14:40:00.000Z", healthStatus: "healthy" as const, uptimePercent: 99.98, responseTimeMs: 171, cpuLoadPercent: 31.8, memoryUsedMb: 3880, diskUsedMb: 38_310, source: "monitor" as const },
  ];
  return { ...site, timezone: "Europe/Moscow", hosting: { provider: "Selectel", planName: "Cloud M", serverRegion: "Москва", monthlyCostMinor: 490_000, renewalOn: "2026-10-03", sslExpiresOn: "2026-12-18", diskCapacityMb: 102_400, memoryCapacityMb: 8192, notes: "Ежедневная резервная копия хранится отдельно от основного сервера." }, health: healthHistory[0], healthHistory };
}
