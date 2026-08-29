import type { AnalyticsSnapshot } from "./types";

function protectSpreadsheetCell(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string | number) {
  const protectedValue = protectSpreadsheetCell(String(value));
  return /[;"\r\n]/.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
}

function csvRow(values: Array<string | number>) {
  return values.map(csvCell).join(";");
}

function decimal(value: number) {
  return value.toFixed(2).replace(".", ",");
}

export function createAnalyticsCsv(snapshot: AnalyticsSnapshot) {
  const rows: string[] = [
    csvRow(["Отчёт CRM", `${snapshot.range.startDate} — ${snapshot.range.endDate}`]),
    csvRow(["Часовой пояс", snapshot.range.timezone]),
    "",
    csvRow(["Ключевые показатели"]),
    csvRow(["Показатель", "Значение", "Изменение"]),
    ...snapshot.metrics.map((metric) => csvRow([metric.label, metric.format === "money" ? decimal(metric.value / 100) : metric.value, metric.change])),
    "",
    csvRow(["Динамика"]),
    csvRow(["Период", ...snapshot.financialTrend.series.map((series) => series.label)]),
    ...snapshot.financialTrend.labels.map((label, index) => csvRow([label, ...snapshot.financialTrend.series.map((series) => decimal(series.values[index] ?? 0))])),
    "",
    csvRow(["Прохождение заказов"]),
    csvRow(["Этап", "Количество", "Процент"]),
    ...snapshot.orderStages.map((stage) => csvRow([stage.label, stage.value, stage.percent])),
    "",
    csvRow(["Структура услуг"]),
    csvRow(["Услуга", "Согласованная стоимость, ₽", "Доля, %"]),
    ...snapshot.serviceMix.map((entry) => csvRow([entry.label, decimal(entry.amountMinor / 100), entry.percent])),
    "",
    csvRow(["Загрузка мастеров"]),
    csvRow(["Мастер", "Выезды", "Завершено, %", "Сумма заказов, ₽"]),
    ...snapshot.teamPerformance.map((entry) => csvRow([entry.name, entry.visits, entry.completion, decimal(entry.orderValueMinor / 100)])),
    "",
    csvRow(["Топ клиентов"]),
    csvRow(["Клиент", "Заказы", "Согласованная стоимость, ₽"]),
    ...snapshot.topClients.map((entry) => csvRow([entry.name, entry.orders, decimal(entry.agreedMinor / 100)])),
  ];
  return rows.join("\r\n");
}
