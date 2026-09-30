"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { createVisitSeriesAction, type CreateVisitSeriesState } from "@/app/(workspace)/calendar/actions";
import { OrderField, OrderFormFooter, OrderFormStatus, orderInputClass, OrderPicker, orderTextareaClass } from "@/components/orders/order-form-parts";
import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { MultiDateCalendar } from "@/components/ui/multi-date-calendar";
import { VisitArrivalModePicker, VisitDurationPicker } from "@/components/visits/visit-form-parts";
import { generateVisitRecurrenceDates, type VisitRecurrenceUnit } from "@/lib/visits/recurrence";
import type { OrderCreationOptions } from "@/server/orders/types";

const initialState: CreateVisitSeriesState = { status: "idle", message: null, fieldErrors: {}, seriesId: null, visitCount: null };

function today() {
  const date = new Date();
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString().slice(0, 10);
}

function oneYearFrom(startDate: string) {
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function VisitSeriesForm({ orderId, requestKey, masters, defaultMasterId, onClose }: {
  orderId: string;
  requestKey: string;
  masters: OrderCreationOptions["masters"];
  defaultMasterId: string | null;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createVisitSeriesAction, initialState);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(() => oneYearFrom(today()));
  const [frequencyUnit, setFrequencyUnit] = useState<VisitRecurrenceUnit>("month");
  const [frequencyInterval, setFrequencyInterval] = useState(1);
  const [scheduleMode, setScheduleMode] = useState<"interval" | "dates">("interval");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [masterId, setMasterId] = useState(defaultMasterId ?? "");
  const [duration, setDuration] = useState(120);
  const [arrivalMode, setArrivalMode] = useState<"fixed" | "window">("fixed");
  const [endTime, setEndTime] = useState("12:00");
  const intervalDates = useMemo(() => {
    try { return generateVisitRecurrenceDates(startsOn, endsOn, frequencyUnit, frequencyInterval); }
    catch { return []; }
  }, [endsOn, frequencyInterval, frequencyUnit, startsOn]);
  const dates = scheduleMode === "dates" ? selectedDates : intervalDates;

  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onClose, 700);
    return () => window.clearTimeout(timeout);
  }, [onClose, state.status]);

  function changeStart(value: string) {
    setStartsOn(value);
    if (value) setEndsOn(oneYearFrom(value));
  }

  return <form action={action} className="flex flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="orderId" value={orderId} />
    <input type="hidden" name="scheduleMode" value={scheduleMode} /><input type="hidden" name="selectedDates" value={JSON.stringify(selectedDates)} />
    <input type="hidden" name="frequencyUnit" value={frequencyUnit} /><input type="hidden" name="assignedMasterId" value={masterId} />
    {scheduleMode === "dates" ? <><input type="hidden" name="startsOn" value={selectedDates[0] ?? today()} /><input type="hidden" name="endsOn" value={selectedDates.at(-1) ?? today()} /><input type="hidden" name="frequencyInterval" value="1" /></> : null}
    <div className="flex-1 space-y-6 p-5 sm:p-7">
      <div role="group" aria-label="Способ выбора дат" className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--surface-inset)] p-1">
        {([ ["interval", "По интервалу"], ["dates", "Выбрать даты"] ] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={scheduleMode === mode} onClick={() => setScheduleMode(mode)} className={`focus-ring min-h-11 rounded-lg px-2 text-xs font-semibold ${scheduleMode === mode ? "bg-black text-white" : "bg-white text-[var(--text)]"}`}>{label}</button>)}
      </div>
      {scheduleMode === "interval" ? <><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Первый выезд" required errors={state.fieldErrors.startsOn}><DateInput name="startsOn" required value={startsOn} onChange={changeStart} /></OrderField><OrderField label="Окончание серии" required errors={state.fieldErrors.endsOn}><DateInput name="endsOn" required value={endsOn} onChange={setEndsOn} /></OrderField><OrderField label="Интервал" required errors={state.fieldErrors.frequencyInterval}><input type="number" name="frequencyInterval" min="1" max="12" required value={frequencyInterval} onChange={(event) => setFrequencyInterval(Number(event.target.value))} className={orderInputClass} /></OrderField></div><OrderPicker label="Повторять" value={frequencyUnit} onChange={(value) => setFrequencyUnit(value as VisitRecurrenceUnit)} options={[{ value: "week", label: "Каждые N недель" }, { value: "month", label: "Каждые N месяцев" }]} placeholder="Выберите период" required errors={state.fieldErrors.frequencyUnit} /></> : <><MultiDateCalendar dates={selectedDates} onChange={setSelectedDates} minDate={today()} maxDate={oneYearFrom(today())} limit={60} />{state.fieldErrors.selectedDates?.[0] ? <p role="alert" className="text-xs text-[var(--danger-ink)]">{state.fieldErrors.selectedDates[0]}</p> : null}</>}
      <VisitArrivalModePicker value={arrivalMode} onChange={setArrivalMode} />
      <OrderField label={arrivalMode === "fixed" ? "Время всех выездов" : "Начало интервала всех выездов"} required errors={state.fieldErrors.localTime}><TimeInput name="localTime" required defaultValue="10:00" /></OrderField>
      {arrivalMode === "window" ? <OrderField label="Окончание интервала" required errors={state.fieldErrors.endTime}><TimeInput name="endTime" required value={endTime} onChange={setEndTime} /></OrderField> : null}
      {arrivalMode === "fixed" ? <VisitDurationPicker value={duration} onChange={setDuration} /> : <input type="hidden" name="durationMinutes" value={duration} />}
      {arrivalMode === "window" ? <p className="text-[10px] text-[var(--muted)]">Если окончание раньше начала, интервал закончится на следующий день.</p> : null}
      <OrderPicker label="Мастер" value={masterId} onChange={setMasterId} options={[{ value: "", label: "Не назначен" }, ...masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} placeholder="Не назначен" searchable searchPlaceholder="ФИО или телефон" errors={state.fieldErrors.assignedMasterId} />
      <OrderField label="Общая заметка" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} placeholder="Заметка попадёт в каждый выезд серии" className={orderTextareaClass} /></OrderField>
      <div className="rounded-[13px] border border-[var(--line-strong)] bg-[var(--surface-inset)] p-4"><div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><CalendarRange className="size-4 text-[var(--accent)]" />Будет создано: <strong>{dates.length}</strong></div>{dates.length ? <p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">{dates.slice(0, 5).map((date) => new Intl.DateTimeFormat("ru-RU").format(new Date(`${date}T12:00:00Z`))).join(" · ")}{dates.length > 5 ? ` · ещё ${dates.length - 5}` : ""}</p> : <p className="mt-2 text-[10px] text-[var(--danger-ink)]">Выберите даты.</p>}<p className="mt-2 text-[10px] leading-4 text-[var(--muted)]">Серия создаётся целиком. Если хотя бы одна дата конфликтует с расписанием мастера, ни один выезд не сохранится.</p></div>
      <OrderFormStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel={`Создать ${dates.length || ""} выездов`.trim()} disabled={!dates.length} />
  </form>;
}
