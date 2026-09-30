"use client";

import { useEffect, useState } from "react";

const MOSCOW_TIME_ZONE = "Europe/Moscow";
const dashboardDateFormatters = {
  day: new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TIME_ZONE, day: "numeric" }),
  month: new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TIME_ZONE, month: "long", year: "numeric" }),
  weekday: new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TIME_ZONE, weekday: "long" }),
  time: new Intl.DateTimeFormat("ru-RU", { timeZone: MOSCOW_TIME_ZONE, hour: "2-digit", minute: "2-digit" }),
};

export function DashboardDateCard({ initialNow }: { initialNow: string }) {
  const [now, setNow] = useState(() => new Date(initialNow));

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <aside className="dashboard-date-card" aria-label="Текущая дата и московское время">
      <strong>{dashboardDateFormatters.day.format(now)}</strong>
      <div>
        <span>{dashboardDateFormatters.month.format(now)}</span>
        <span>{dashboardDateFormatters.weekday.format(now)}</span>
        <time dateTime={now.toISOString()}>{dashboardDateFormatters.time.format(now)} · Москва</time>
      </div>
    </aside>
  );
}
