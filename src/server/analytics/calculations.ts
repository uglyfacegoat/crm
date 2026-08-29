import type { AnalyticsRange } from "./types.ts";

export function describeChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? "Без изменений" : "Новый показатель";
  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  const absolutePercent = Math.abs(percent);
  return `${sign}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(absolutePercent)}%`;
}

function dateFromKey(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function firstBucket(startDate: string, range: AnalyticsRange) {
  const date = dateFromKey(startDate);
  if (range === 90) {
    const weekday = date.getUTCDay() || 7;
    return addUtcDays(date, 1 - weekday);
  }
  if (range === 365) {
    date.setUTCDate(1);
  }
  return date;
}

export function createAnalyticsBuckets(startDate: string, endDate: string, range: AnalyticsRange) {
  const end = dateFromKey(endDate);
  const buckets: Array<{ key: string; label: string }> = [];
  const formatter = new Intl.DateTimeFormat("ru-RU", range === 365
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { day: "2-digit", month: "short", timeZone: "UTC" });

  for (let date = firstBucket(startDate, range); date <= end;) {
    buckets.push({ key: dateKey(date), label: formatter.format(date).replace(" г.", "") });
    if (range === 365) {
      const next = new Date(date);
      next.setUTCMonth(next.getUTCMonth() + 1);
      date = next;
    } else {
      date = addUtcDays(date, range === 90 ? 7 : 1);
    }
  }
  return buckets;
}
