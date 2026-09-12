"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

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
    return { date: formatDateOnly(date), label: dayLabelFormatter.format(date).replace(",", "") };
  });

  return (
    <section aria-labelledby="dashboard-calendar-heading" className="surface-panel dashboard-panel animate-rise min-w-0" style={{ animationDelay: "420ms" }}>
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-4 py-3.5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Планирование</p>
          <h2 id="dashboard-calendar-heading" className="mt-2 text-[clamp(1rem,0.9rem+0.23vw,1.2rem)] font-semibold tracking-[-0.025em] text-[var(--text)]">Календарь выездов</h2>
          <p className="mt-1 truncate text-[10px] capitalize text-[var(--muted)]">{selectedDateFormatter.format(selectedDateValue)}</p>
        </div>
        <div className="flex shrink-0 items-center rounded-full border border-[var(--line)] bg-[var(--surface-inset)] p-1">
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="focus-ring grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"><ChevronLeft className="size-3.5" /></button>
          <span className="px-2 text-[9px] font-medium text-[var(--text-secondary)]">День</span>
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="focus-ring grid size-8 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"><ChevronRight className="size-3.5" /></button>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-7 gap-1 border-b border-[var(--line)] pb-3">
          {days.map((day) => (
            <button key={day.date} type="button" onClick={() => setSelectedDate(day.date)} aria-pressed={day.date === selectedDate} className={`focus-ring min-w-0 rounded-full py-2 text-center text-[9px] capitalize transition-colors ${day.date === selectedDate ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{day.label}</button>
          ))}
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] p-2">
          {selectedVisits.length ? <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{selectedVisits.slice(0, 4).map((visit) => {
            const destination = visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}`;
            return <Link key={visit.id} href={destination} title={`${visit.time} · ${visit.client} · ${visit.address}`} className={`focus-ring grid min-h-[3.2rem] grid-cols-[3.4rem_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-2 transition-[filter] hover:brightness-[0.97] ${eventColors[visit.tone]}`}>
              <strong className="font-display text-[9px] font-semibold">{visit.time}</strong>
              <span className="min-w-0"><span className="block truncate text-[9px] font-medium text-[var(--text)]">{visit.client}</span><span className="mt-0.5 block truncate text-[8px] opacity-65">{visit.address} · {visit.master}</span></span>
              <span className="shrink-0 text-[8px] opacity-65">{visit.orderNumber ?? "Без заказа"}</span>
            </Link>;
          })}{selectedVisits.length > 4 ? <Link href={`/calendar?date=${selectedDate}`} className="focus-ring block py-2 text-center text-[9px] text-[var(--accent-ink)]">Ещё {selectedVisits.length - 4} выезд.</Link> : null}</div> : <div className="grid place-items-center py-7 text-center"><div><CalendarDays className="mx-auto size-6 text-[var(--muted-subtle)]" /><p className="mt-2 text-[10px] text-[var(--muted)]">На этот день выездов нет</p></div></div>}
        </div>

        <Link href={`/calendar?date=${selectedDate}`} className="focus-ring mt-3 inline-flex w-fit items-center gap-2 rounded-full px-2 py-1.5 text-[11px] font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-soft)]">Открыть день в календаре <ArrowRight className="size-3.5" /></Link>
      </div>
    </section>
  );
}
