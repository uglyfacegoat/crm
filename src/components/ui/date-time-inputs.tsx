"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateInput, formatIsoDateForInput, formatTimeInput, parseDateInput, parseTimeInput } from "@/lib/date-input";

const monthFormatter = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function isoFromDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateFromIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function calendarDays(month: Date) {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date;
  });
}

type DateInputProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

export function DateInput({ name, value, defaultValue = "", onChange, required, disabled, readOnly, min, max, className = "", "aria-label": ariaLabel = "Дата в формате ДД.ММ.ГГГГ", "data-testid": testId }: DateInputProps) {
  const initialValue = value ?? defaultValue;
  const [isoValue, setIsoValue] = useState(initialValue);
  const [displayValue, setDisplayValue] = useState(formatIsoDateForInput(initialValue));
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => dateFromIso(initialValue) ?? new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, []);

  function commit(nextValue: string) {
    setIsoValue(nextValue);
    onChange?.(nextValue);
  }

  function chooseDate(date: Date) {
    const nextValue = isoFromDate(date);
    commit(nextValue);
    setDisplayValue(formatIsoDateForInput(nextValue));
    setVisibleMonth(date);
    setOpen(false);
  }

  return <div ref={containerRef} className="relative min-w-0">
    <input type="hidden" name={name} value={isoValue} required={required} />
    <div className={`flex h-12 min-w-0 items-center rounded-[12px] border border-white/[0.08] bg-black/15 focus-within:border-[var(--accent)]/45 ${disabled || readOnly ? "opacity-55" : ""} ${className}`}>
      <input
        data-testid={testId}
        data-form-name={name}
        inputMode="numeric"
        autoComplete="off"
        value={displayValue}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel}
        placeholder="ДД.ММ.ГГГГ"
        className="min-w-0 flex-1 bg-transparent px-3.5 text-sm text-white outline-none placeholder:text-[#566067]"
        onChange={(event) => {
          const formatted = formatDateInput(event.target.value);
          setDisplayValue(formatted);
          commit(parseDateInput(formatted) ?? "");
        }}
      />
      <button type="button" disabled={disabled || readOnly} aria-label="Открыть календарь" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="focus-ring mr-1 grid size-10 shrink-0 place-items-center rounded-[10px] text-[#7b858b] hover:bg-white/[0.04] hover:text-white disabled:cursor-not-allowed"><CalendarDays className="size-4" /></button>
    </div>
    {open ? <div role="dialog" aria-label="Выбор даты" className="fixed inset-x-3 top-1/2 z-[90] -translate-y-1/2 rounded-[16px] border border-white/[0.1] bg-[#11191e] p-3 shadow-2xl sm:absolute sm:left-0 sm:right-auto sm:top-[3.35rem] sm:w-[18rem] sm:translate-y-0">
      <header className="mb-3 flex items-center justify-between gap-2"><button type="button" aria-label="Предыдущий месяц" onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() - 1, 1)))} className="focus-ring grid size-9 place-items-center rounded-[9px] border border-white/[0.07] text-[#8a9499]"><ChevronLeft className="size-4" /></button><strong className="capitalize text-xs text-white">{monthFormatter.format(visibleMonth)}</strong><button type="button" aria-label="Следующий месяц" onClick={() => setVisibleMonth(new Date(Date.UTC(visibleMonth.getUTCFullYear(), visibleMonth.getUTCMonth() + 1, 1)))} className="focus-ring grid size-9 place-items-center rounded-[9px] border border-white/[0.07] text-[#8a9499]"><ChevronRight className="size-4" /></button></header>
      <div className="grid grid-cols-7 gap-1">{weekDays.map((day) => <span key={day} className="grid h-7 place-items-center text-[9px] text-[#657078]">{day}</span>)}{days.map((date) => { const dayIso = isoFromDate(date); const outsideMonth = date.getUTCMonth() !== visibleMonth.getUTCMonth(); const unavailable = Boolean((min && dayIso < min) || (max && dayIso > max)); return <button key={dayIso} type="button" disabled={unavailable} aria-label={dayIso} aria-pressed={dayIso === isoValue} onClick={() => chooseDate(date)} className={`focus-ring grid aspect-square place-items-center rounded-[9px] text-[10px] ${dayIso === isoValue ? "bg-[var(--accent)] font-semibold text-[#25272c]" : outsideMonth ? "text-[#465158] hover:bg-white/[0.04]" : "text-[#aab2b6] hover:bg-white/[0.06]"} disabled:cursor-not-allowed disabled:opacity-20`}>{date.getUTCDate()}</button>; })}</div>
    </div> : null}
  </div>;
}

type TimeInputProps = {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  step?: string | number;
  "data-testid"?: string;
};

export function TimeInput({ name, value, defaultValue = "", onChange, required, disabled, className = "", "data-testid": testId }: TimeInputProps) {
  const initialValue = value ?? defaultValue;
  const [displayValue, setDisplayValue] = useState(initialValue);
  const parsedValue = parseTimeInput(displayValue) ?? "";

  return <div className={`flex h-12 min-w-0 items-center rounded-[12px] border border-white/[0.08] bg-black/15 focus-within:border-[var(--accent)]/45 ${disabled ? "opacity-55" : ""} ${className}`}>
    <input type="hidden" name={name} value={parsedValue} required={required} />
    <input
      data-testid={testId}
      data-form-name={name}
      inputMode="numeric"
      autoComplete="off"
      value={displayValue}
      disabled={disabled}
      aria-label="Время в формате ЧЧ:ММ"
      placeholder="ЧЧ:ММ"
      className="min-w-0 flex-1 bg-transparent px-3.5 text-sm tabular-nums text-white outline-none placeholder:text-[#566067]"
      onChange={(event) => {
        const formatted = formatTimeInput(event.target.value);
        setDisplayValue(formatted);
        onChange?.(parseTimeInput(formatted) ?? "");
      }}
    />
    <Clock3 className="mr-4 size-4 shrink-0 text-[#7b858b]" />
  </div>;
}
