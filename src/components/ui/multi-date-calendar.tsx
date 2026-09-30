"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const weekdays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function label(date: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

export function MultiDateCalendar({ dates, onChange, minDate, maxDate, limit = 60, showSelectedDates = true }: {
  dates: string[]; onChange: (dates: string[]) => void; minDate: string; maxDate: string; limit?: number; showSelectedDates?: boolean;
}) {
  const [month, setMonth] = useState(() => {
    const initial = dates[0] ?? minDate;
    return new Date(`${initial.slice(0, 7)}-01T12:00:00Z`);
  });
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => index - firstWeekday + 1);
  const minMonth = minDate.slice(0, 7);
  const maxMonth = maxDate.slice(0, 7);

  function move(offset: number) {
    setMonth(new Date(Date.UTC(year, monthIndex + offset, 1, 12)));
  }
  function toggle(date: string) {
    if (dates.includes(date)) onChange(dates.filter((entry) => entry !== date));
    else if (dates.length < limit) onChange([...dates, date].sort());
  }

  return <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 sm:p-4">
    <div className="flex items-center justify-between gap-3">
      <button type="button" aria-label="Предыдущий месяц" disabled={`${year}-${String(monthIndex + 1).padStart(2, "0")}` <= minMonth} onClick={() => move(-1)} className="focus-ring grid size-10 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-30"><ChevronLeft className="size-4" /></button>
      <strong className="text-sm">{months[monthIndex]} {year}</strong>
      <button type="button" aria-label="Следующий месяц" disabled={`${year}-${String(monthIndex + 1).padStart(2, "0")}` >= maxMonth} onClick={() => move(1)} className="focus-ring grid size-10 place-items-center rounded-lg border border-[var(--line)] disabled:opacity-30"><ChevronRight className="size-4" /></button>
    </div>
    <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">{weekdays.map((day) => <span key={day} className="py-2 text-[var(--muted)]">{day}</span>)}
      {cells.map((day, index) => {
        if (day < 1 || day > daysInMonth) return <span key={`blank-${index}`} />;
        const key = dateKey(year, monthIndex, day);
        const selected = dates.includes(key);
        return <button key={key} type="button" aria-label={`${label(key)}${selected ? ", выбрано" : ""}`} aria-pressed={selected} disabled={key < minDate || key > maxDate || (!selected && dates.length >= limit)} onClick={() => toggle(key)} className={`focus-ring min-h-10 rounded-lg text-sm disabled:opacity-30 ${selected ? "bg-[var(--accent)] font-semibold text-[var(--on-accent)]" : "hover:bg-[var(--surface-inset)]"}`}>{day}</button>;
      })}
    </div>
    <div className="mt-3 border-t border-[var(--line)] pt-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold">Выбрано дат: {dates.length}</span>{dates.length ? <button type="button" onClick={() => onChange([])} className="focus-ring text-xs text-[var(--muted)] underline">Очистить</button> : null}</div>
      {dates.length ? showSelectedDates ? <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{dates.map((date) => <button type="button" key={date} onClick={() => toggle(date)} aria-label={`Убрать ${label(date)}`} className="focus-ring rounded-lg bg-[var(--surface-inset)] px-2 py-1 text-xs">{label(date)} ×</button>)}</div> : null : <p className="mt-1 text-xs text-[var(--muted)]">Отметьте нужные дни в календаре.</p>}
    </div>
  </div>;
}
