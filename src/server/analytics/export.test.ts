import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsCsv } from "./export.ts";
import type { AnalyticsSnapshot } from "./types.ts";

const snapshot: AnalyticsSnapshot = {
  range: { days: 30, startDate: "2026-08-01", endDate: "2026-08-30", timezone: "Europe/Moscow" },
  metrics: [{ id: "agreed", label: "Согласовано", value: 125050, format: "money", change: "+10%", tone: "lime" }],
  financialTrend: { labels: ["01 авг."], series: [{ label: "Получено", color: "#fff", values: [500.25], valueFormat: "money" }] },
  orderStages: [{ label: "Создано", value: 2, percent: 100 }],
  serviceMix: [{ label: "=опасная формула", percent: 100, amountMinor: 125050, color: "#fff" }],
  teamPerformance: [{ id: "00000000-0000-0000-0000-000000000001", name: "Иван; Петров", visits: 2, completion: 50, orderValueMinor: 125050 }],
  topClients: [{ id: "00000000-0000-0000-0000-000000000002", name: "ООО Клиент", orders: 2, agreedMinor: 125050 }],
  repeatClientRate: 0,
  completedVisitRate: 0,
};

test("analytics CSV uses Excel-friendly delimiters and protects formula cells", () => {
  const csv = createAnalyticsCsv(snapshot);
  assert.match(csv, /Согласовано;1250,50;'\+10%/);
  assert.match(csv, /'=опасная формула;1250,50;100/);
  assert.match(csv, /"Иван; Петров";2;50;1250,50/);
  assert.ok(csv.includes("\r\n"));
});
