import { createPreviewPeriod, shiftPreviewDate } from "../preview-period.ts";
import type { WebsiteDetail, WebsiteSnapshot } from "./types.ts";

export function getPreviewWebsiteSnapshot(now = new Date()): WebsiteSnapshot {
  const period = createPreviewPeriod(30, 30, now);
  const sites = [
    { id: "site-1", name: "Городская дезслужба", domain: "dez-control.ru", status: "active" as const, version: 1, visitors: 18_420, pageviews: 34_860, leads: 286, orders: 72, paidOrders: 47, paidRevenueMinor: 11_750_000, conversionPercent: 1.55, trafficHistory: [42, 48, 45, 53, 46, 58, 51, 63], integrations: [] },
    { id: "site-2", name: "Контроль грызунов", domain: "stop-rodent.ru", status: "active" as const, version: 1, visitors: 9_870, pageviews: 22_184, leads: 194, orders: 49, paidOrders: 31, paidRevenueMinor: 7_920_000, conversionPercent: 1.97, trafficHistory: [25, 29, 27, 31, 35, 33, 38, 39], integrations: [] },
    { id: "site-3", name: "Утилизация для бизнеса", domain: "eco-util.ru", status: "attention" as const, version: 1, visitors: 4_630, pageviews: 11_191, leads: 61, orders: 18, paidOrders: 8, paidRevenueMinor: 2_160_000, conversionPercent: 1.32, trafficHistory: [11, 10, 13, 15, 14, 17, 16, 22], integrations: [] },
    { id: "site-4", name: "Новый региональный сайт", domain: "podolsk-dez.ru", status: "setup" as const, version: 1, visitors: 0, pageviews: 0, leads: 0, orders: 0, paidOrders: 0, paidRevenueMinor: 0, conversionPercent: 0, trafficHistory: [], integrations: [] },
  ];
  return {
    period: { startDate: period.startDate, endDate: period.endDate, timezone: period.timezone },
    summary: { totalSites: 4, activeSites: 2, visitors: 32_920, pageviews: 68_235, searchClicks: 8_420, leads: 541, orders: 139, paidOrders: 86, paidRevenueMinor: 21_830_000, conversionPercent: 1.64 },
    sites,
    trafficTrend: { labels: period.labels, series: [
      { label: "Посетители", color: "#25272c", values: [500, 820, 790, 700, 850, 1050, 920, 760, 1110, 950, 1250, 940, 1120, 1180, 1020, 1230, 1100, 1270, 850, 980, 1210, 1180, 1260, 1410, 1470, 1220, 1490, 1500, 1490, 1300] },
    ] },
    trafficSources: [
      { label: "Органический поиск", value: 46, amount: 249 },
      { label: "Реклама", value: 28, amount: 151 },
      { label: "Прямые заходы", value: 17, amount: 92 },
      { label: "Карты и каталоги", value: 9, amount: 49 },
    ],
  };
}

export function getPreviewWebsiteDetail(websiteId: string, now = new Date()): WebsiteDetail | null {
  const snapshot = getPreviewWebsiteSnapshot(now);
  const site = snapshot.sites.find((entry) => entry.id === websiteId);
  if (!site) return null;
  const responseTimes = [166, 182, 174, 208, 192, 214, 322, 278, 196, 172, 162, 184, 168, 184];
  const healthHistory = responseTimes.map((responseTimeMs, index) => ({
    id: `health-${index + 1}`,
    measuredAt: `${shiftPreviewDate(snapshot.period.endDate, -index * 2)}T11:20:00.000Z`,
    healthStatus: index === 6 || index === 7 ? "degraded" as const : "healthy" as const,
    uptimePercent: index === 6 || index === 7 ? 99.4 : 99.98,
    responseTimeMs,
    cpuLoadPercent: 28 + (index % 5) * 4.1,
    memoryUsedMb: 3277 + index * 41,
    diskUsedMb: 49_152 + index * 24,
    source: "monitor" as const,
  }));
  return { ...site, timezone: snapshot.period.timezone, hosting: { provider: "Selectel", planName: "Cloud M", serverRegion: "Москва", monthlyCostMinor: 490_000, renewalOn: shiftPreviewDate(snapshot.period.endDate, 15), sslExpiresOn: shiftPreviewDate(snapshot.period.endDate, 91), diskCapacityMb: 102_400, memoryCapacityMb: 8192, notes: "Ежедневная резервная копия хранится отдельно от основного сервера." }, health: healthHistory[0], healthHistory };
}
