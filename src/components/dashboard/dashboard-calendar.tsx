"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";

export type DashboardVisitTone = "warning" | "support" | "accent" | "success" | "danger";

export type DashboardVisit = {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  date: string;
  time: string;
  client: string;
  address: string;
  master: string;
  tone: DashboardVisitTone;
};

const eventColors: Record<DashboardVisitTone, string> = {
  warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  support: "border-[var(--support-strong)] bg-[var(--support-soft)] text-[var(--support-strong)]",
  accent: "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

const millisecondsPerDay = 86_400_000;

function parseDateOnly(date: string) {
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime())) throw new Error(`Invalid visit date: ${date}`);
  return parsedDate;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number) {
  return formatDateOnly(new Date(parseDateOnly(date).getTime() + days * millisecondsPerDay));
}

function startOfWeek(date: Date) {
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - mondayOffset * millisecondsPerDay);
}

const dayLabelFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", timeZone: "UTC" });
const selectedDateFormatter = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export function DashboardCalendar({ visits, initialDate }: { visits: DashboardVisit[]; initialDate: string }) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const selectedDateValue = parseDateOnly(selectedDate);
  const selectedVisits = visits.filter((visit) => visit.date === selectedDate).toSorted((left, right) => left.time.localeCompare(right.time));
  const weekStart = startOfWeek(selectedDateValue);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getTime() + index * millisecondsPerDay);
    const dateKey = formatDateOnly(date);
    return {
      date: dateKey,
      label: dayLabelFormatter.format(date).replace(",", ""),
      count: visits.filter((visit) => visit.date === dateKey).length,
    };
  });

  return (
    <section aria-labelledby="dashboard-calendar-heading" className="surface-panel dashboard-panel dashboard-calendar-panel animate-rise min-w-0" style={{ animationDelay: "420ms" }}>
      <div className="dashboard-card-header">
        <div className="min-w-0">
          <p className="dashboard-card-kicker">Планирование</p>
          <h2 id="dashboard-calendar-heading">Календарь выездов</h2>
          <time dateTime={selectedDate} aria-live="polite">{selectedDateFormatter.format(selectedDateValue)}</time>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="focus-ring grid size-8 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"><ChevronLeft className="size-3.5" /></button>
          <span className="px-2 text-[9px] font-medium text-[var(--text-secondary)]">День</span>
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="focus-ring grid size-8 place-items-center rounded-full border border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"><ChevronRight className="size-3.5" /></button>
        </div>
      </div>

      <div className="dashboard-calendar-body">
        <div className="dashboard-calendar-days">
          {days.map((day) => (
            <button key={day.date} type="button" onClick={() => setSelectedDate(day.date)} aria-pressed={day.date === selectedDate} className="focus-ring">
              <span>{day.label}</span>
              <strong>{day.count || "—"}</strong>
              <small>{day.count ? "выездов" : "нет данных"}</small>
            </button>
          ))}
        </div>

        <h3>{selectedDateFormatter.format(selectedDateValue)}</h3>
        <div className="dashboard-calendar-visits">
          {selectedVisits.length ? <div>{selectedVisits.slice(0, 4).map((visit) => {
            const destination = visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}&view=day`;
            return <Link key={visit.id} href={destination} title={`${visit.time} · ${visit.client} · ${visit.address}`} className={`focus-ring dashboard-calendar-visit ${eventColors[visit.tone]}`}>
              <strong>{visit.time}</strong>
              <span><b>{visit.client}</b><small>{visit.address} · {visit.master}</small></span>
              <em>{visit.orderNumber ?? "Без заказа"}</em>
            </Link>;
          })}{selectedVisits.length > 4 ? <Link href={`/calendar?date=${selectedDate}&view=day`} className="dashboard-calendar-more">Ещё {selectedVisits.length - 4} выезд.</Link> : null}</div> : <div className="dashboard-calendar-empty"><CalendarDays /><p>На этот день выездов нет</p></div>}
        </div>
      </div>
      <DashboardPanelLink href={`/calendar?date=${selectedDate}&view=day`}>Открыть день в календаре</DashboardPanelLink>
    </section>
  );
}
