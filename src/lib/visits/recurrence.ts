export type VisitRecurrenceUnit = "week" | "month";

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Recurrence dates must use YYYY-MM-DD format.");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    throw new RangeError("Recurrence date is invalid.");
  }
  return { date, year, monthIndex, day };
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthlyOccurrence(year: number, monthIndex: number, anchorDay: number, offset: number) {
  const firstOfTarget = new Date(Date.UTC(year, monthIndex + offset, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(anchorDay, lastDay)));
}

export function generateVisitRecurrenceDates(startDate: string, endDate: string, unit: VisitRecurrenceUnit, interval: number) {
  if (!Number.isInteger(interval) || interval < 1 || interval > 12) throw new RangeError("Recurrence interval must be between 1 and 12.");
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate).date;
  if (end < start.date) throw new RangeError("Recurrence end must not be before its start.");

  const dates: string[] = [];
  for (let occurrence = 0; occurrence < 100; occurrence += 1) {
    const date = unit === "week"
      ? new Date(start.date.getTime() + occurrence * interval * 7 * 86_400_000)
      : monthlyOccurrence(start.year, start.monthIndex, start.day, occurrence * interval);
    if (date > end) break;
    dates.push(formatDateOnly(date));
  }
  if (dates.length === 100) throw new RangeError("Recurrence contains too many visits.");
  return dates;
}
