"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export type DashboardVisit = {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  date: string;
  time: string;
  client: string;
  address: string;
  master: string;
  color: keyof typeof eventColors;
};

const eventColors = {
  lime: "border-[#dce63c]/25 bg-[#dce63c]/15 text-[#e5eb85]",
  violet: "border-[#9c82e8]/25 bg-[#9c82e8]/15 text-[#c2b3ed]",
  mint: "border-[#55d5ca]/25 bg-[#55d5ca]/15 text-[#9ae2da]",
  yellow: "border-[#f2a84b]/25 bg-[#f2a84b]/15 text-[#efc38b]",
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
    <section className="surface-panel animate-rise min-w-0" style={{ animationDelay: "420ms" }}>
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Календарь выездов</h2>
          <p className="mt-1 truncate text-[9px] capitalize text-[#69737a]">{selectedDateFormatter.format(selectedDateValue)}</p>
        </div>
        <div className="flex shrink-0 items-center rounded-[11px] border border-white/[0.07] bg-black/10 p-1">
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, -1))} aria-label="Предыдущий день" className="focus-ring grid size-8 place-items-center rounded-lg text-[#778188] hover:bg-white/[0.05] hover:text-white"><ChevronLeft className="size-3.5" /></button>
          <span className="px-2 text-[9px] font-medium text-[#a9b1b4]">День</span>
          <button type="button" onClick={() => setSelectedDate((date) => shiftDate(date, 1))} aria-label="Следующий день" className="focus-ring grid size-8 place-items-center rounded-lg text-[#778188] hover:bg-white/[0.05] hover:text-white"><ChevronRight className="size-3.5" /></button>
        </div>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-7 gap-1 border-b border-white/[0.06] pb-2">
          {days.map((day) => (
            <button key={day.date} type="button" onClick={() => setSelectedDate(day.date)} aria-pressed={day.date === selectedDate} className={`focus-ring min-w-0 rounded-lg py-2 text-center text-[9px] capitalize transition-colors ${day.date === selectedDate ? "bg-[var(--accent)] font-semibold text-[#111508]" : "text-[#788289] hover:bg-white/[0.04] hover:text-white"}`}>{day.label}</button>
          ))}
        </div>

        <div className="mt-2 min-h-[15.5rem] overflow-hidden rounded-xl border border-white/[0.045] bg-[#0a1013]/45 p-2">
          {selectedVisits.length ? <div className="space-y-1.5">{selectedVisits.slice(0, 4).map((visit) => {
            const destination = visit.orderId ? `/orders/${visit.orderId}` : `/calendar?date=${visit.date}`;
            return <Link key={visit.id} href={destination} title={`${visit.time} · ${visit.client} · ${visit.address}`} className={`focus-ring grid min-h-[3.2rem] grid-cols-[3.4rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border px-2.5 py-2 transition-[border-color,filter] hover:brightness-110 ${eventColors[visit.color]}`}>
              <strong className="font-display text-[9px] font-semibold">{visit.time}</strong>
              <span className="min-w-0"><span className="block truncate text-[9px] font-medium text-white">{visit.client}</span><span className="mt-0.5 block truncate text-[8px] opacity-65">{visit.address} · {visit.master}</span></span>
              <span className="shrink-0 text-[8px] opacity-65">{visit.orderNumber ?? "Без заказа"}</span>
            </Link>;
          })}{selectedVisits.length > 4 ? <Link href={`/calendar?date=${selectedDate}`} className="focus-ring block rounded-lg py-2 text-center text-[9px] text-[var(--accent)]">Ещё {selectedVisits.length - 4} выезд.</Link> : null}</div> : <div className="grid min-h-[14.25rem] place-items-center px-5 text-center"><div><CalendarDays className="mx-auto size-6 text-[#465159]" /><p className="mt-2 text-[10px] text-[#69737a]">На этот день выездов нет</p></div></div>}
        </div>

        <Link href={`/calendar?date=${selectedDate}`} className="focus-ring mt-2 flex items-center gap-2 rounded-lg text-[11px] font-semibold text-[var(--accent)]">Открыть день в календаре <ArrowRight className="size-3.5" /></Link>
      </div>
    </section>
  );
}
