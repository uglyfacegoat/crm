import { createPreviewPeriod } from "../preview-period.ts";
import type { AnalyticsRange, AnalyticsSnapshot } from "./types.ts";

export function getPreviewAnalytics(range: AnalyticsRange, now = new Date()): AnalyticsSnapshot {
  const financialPeriod = createPreviewPeriod(range, 8, now);
  const activityPeriod = createPreviewPeriod(range, 30, now);
  return {
    range: { days: range, startDate: financialPeriod.startDate, endDate: financialPeriod.endDate, timezone: financialPeriod.timezone },
    metrics: [
      { id: "agreed", label: "Согласовано", value: 12_500_000, format: "money", change: "+18,2%", tone: "lime" },
      { id: "paid", label: "Получено", value: 10_820_000, format: "money", change: "+14,6%", tone: "mint" },
      { id: "orders", label: "Новых заказов", value: 47, format: "integer", change: "+12,1%", tone: "violet" },
      { id: "visits", label: "Выездов", value: 124, format: "integer", change: "+9,4%", tone: "amber" },
      { id: "clients", label: "Новых клиентов", value: 18, format: "integer", change: "+20%", tone: "mint" },
      { id: "average_order", label: "Средний чек", value: 2_451_000, format: "money", change: "+6,8%", tone: "violet" },
    ],
    financialTrend: {
      labels: financialPeriod.labels,
      series: [
        { label: "Согласовано", color: "#000000", values: [6800, 7450, 7200, 8600, 9400, 10100, 11400, 12500], valueFormat: "money" },
        { label: "Плановый опер. остаток", color: "#a2beff", values: [3520, 3980, 3760, 4720, 5350, 6020, 6760, 7420], valueFormat: "money" },
        { label: "Получено", color: "#25272c", values: [3100, 4200, 4500, 5100, 7200, 8100, 9200, 10820], valueFormat: "money" },
      ],
    },
    orderStages: [
      { label: "Создано", value: 47, percent: 100 },
      { label: "Прошли согласование", value: 39, percent: 83 },
      { label: "Назначены в работу", value: 31, percent: 66 },
      { label: "Выполнены", value: 23, percent: 49 },
    ],
    serviceMix: [
      { label: "Дезинсекция", percent: 38, amountMinor: 4_750_000, color: "#000000" },
      { label: "Дератизация", percent: 27, amountMinor: 3_375_000, color: "#a2beff" },
      { label: "Дезинфекция", percent: 21, amountMinor: 2_625_000, color: "#25272c" },
      { label: "Утилизация", percent: 14, amountMinor: 1_750_000, color: "#f6f5f0" },
    ],
    teamPerformance: [
      { id: "m-1", name: "Алексей Смирнов", visits: 38, completion: 96, orderValueMinor: 3_180_000 },
      { id: "m-2", name: "Дмитрий Кузнецов", visits: 34, completion: 91, orderValueMinor: 2_865_000 },
      { id: "m-3", name: "Сергей Волков", visits: 29, completion: 88, orderValueMinor: 2_490_000 },
      { id: "m-4", name: "Иван Петров", visits: 27, completion: 84, orderValueMinor: 2_210_000 },
    ],
    topClients: [
      { id: "c-1", name: "ООО «Домжилсервис»", orders: 12, agreedMinor: 2_450_000 },
      { id: "c-2", name: "ТСЖ «Пруды»", orders: 7, agreedMinor: 1_850_000 },
      { id: "c-3", name: "ООО «Вектор»", orders: 5, agreedMinor: 1_200_000 },
    ],
    repeatClientRate: 64,
    repeatClientCounts: { repeat: 16, firstTime: 9 },
    completedVisitRate: 82,
    visitActivity: [
      3, 5, 2, 6, 4, 8, 3,
      5, 7, 4, 6, 6, 8, 2,
      4, 3, 5, 7, 6, 8, 6,
      7, 9, 5, 7, 4, 6, 5,
      4, 6,
    ].map((value, index) => ({ key: activityPeriod.dates[index], label: activityPeriod.labels[index], value })),
    orderStatusBreakdown: [
      { id: "new", label: "Новые", value: 8 },
      { id: "in_progress", label: "В работе", value: 6 },
      { id: "scheduled", label: "План", value: 4 },
      { id: "approved", label: "Согласование", value: 2 },
      { id: "completed", label: "Выполнено", value: 25 },
      { id: "cancelled", label: "Отменено", value: 2 },
    ],
  };
}
