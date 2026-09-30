const previewTimeZone = "Europe/Moscow";
const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayWithYearFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function localDateKey(date: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: previewTimeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftPreviewDate(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatLabel(dateKey: string, includeYear: boolean) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  return (includeYear ? dayWithYearFormatter : dayFormatter)
    .format(date)
    .replaceAll(".", "");
}

export function createPreviewPeriod(days: number, pointCount: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1) throw new RangeError("Preview period must contain at least one day.");
  if (!Number.isInteger(pointCount) || pointCount < 1) throw new RangeError("Preview period must contain at least one point.");

  const endDate = localDateKey(now);
  const startDate = shiftPreviewDate(endDate, -(days - 1));
  const includeYear = startDate.slice(0, 4) !== endDate.slice(0, 4);
  const dates = Array.from({ length: pointCount }, (_, index) => {
    const offset = pointCount === 1 ? days - 1 : Math.round(index * (days - 1) / (pointCount - 1));
    return shiftPreviewDate(startDate, offset);
  });

  return {
    startDate,
    endDate,
    timezone: previewTimeZone,
    dates,
    labels: dates.map((date) => formatLabel(date, includeYear)),
  };
}
