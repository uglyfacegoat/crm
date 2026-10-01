"use client";

import { useActionState, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Copy, Link2, Plus, ReceiptText, Trash2 } from "lucide-react";
import { copyOrderAction, type CopyOrderState } from "@/app/(workspace)/orders/actions";
import { createVisitSeriesAction, type CreateVisitSeriesState } from "@/app/(workspace)/calendar/actions";
import { ServiceChoice, resolveServiceChoice } from "@/components/catalog/service-choice";
import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { MultiDateCalendar } from "@/components/ui/multi-date-calendar";
import { clientCrypto } from "@/lib/client-id";
import { formatMoneyMinor } from "@/lib/format";
import { generateVisitRecurrenceDates, type VisitRecurrenceUnit } from "@/lib/visits/recurrence";
import { calculateServiceLineTotalMinor, parseMoneyToMinorUnits, parseQuantityToMilliunits } from "@/server/orders/money";
import type { OrderDetail, OrderCreationOptions } from "@/server/orders/types";
import type { ServiceVisit } from "@/server/visits/types";
import { OrderField, OrderPicker, OrderFormFooter, OrderFormStatus, orderInputClass, orderTextareaClass } from "./order-form-parts";

type Row = { id: string; sourceId: string | null; enabled: boolean; catalogItemId: string | null; name: string; kind: "service" | "product"; unit: string; quantity: string; unitPrice: string };
type Configuration = { masterId: string; masterPayment: string; schedule: boolean; arrivalMode: "fixed" | "window"; startTime: string; endTime: string; rows: Row[]; expenseIds: string[]; notes: string; visitNotes: string };
const initialState: CopyOrderState = { status: "idle", message: null, fieldErrors: {}, orderId: null };
const dateLabel = (date: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const countLabel = (count: number, forms: [string, string, string]) => `${count} ${forms[count % 100 >= 11 && count % 100 <= 14 ? 2 : count % 10 === 1 ? 0 : count % 10 >= 2 && count % 10 <= 4 ? 1 : 2]}`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const visitTime = (value?: string) => value ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "10:00";
function rowTotal(row: Row) { try { return Number(calculateServiceLineTotalMinor(parseMoneyToMinorUnits(row.unitPrice), parseQuantityToMilliunits(row.quantity))); } catch { return 0; } }

function FormDisclosure({ title, detail, icon, children }: { title: string; detail: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className="overflow-hidden rounded-2xl border border-[var(--line)]">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)} className="focus-ring flex min-h-16 w-full items-center gap-3 bg-[var(--surface-inset)] px-4 py-3 text-left">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--line)] bg-[var(--surface)]">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="mt-1 block text-xs text-[var(--muted)]">{detail}</span></span>
      <ChevronDown className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    <div id={id} hidden={!open} className="space-y-3 border-t border-[var(--line)] p-4">{children}</div>
  </section>;
}

export function CopyOrderForm({ order, options, visits, canWriteFinance, canScheduleVisit, requestKey, onClose }: {
  order: OrderDetail; options: OrderCreationOptions; visits: ServiceVisit[]; canWriteFinance: boolean; canScheduleVisit: boolean; requestKey: string; onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<"copy" | "series">("copy");
  const isSeries = target === "series";
  const limit = isSeries ? 60 : 24;
  const [state, action, pending] = useActionState(async (previous: CopyOrderState, data: FormData): Promise<CopyOrderState> => {
    if (target === "copy") return copyOrderAction(previous, data);
    const empty: CreateVisitSeriesState = { status: "idle", message: null, fieldErrors: {}, seriesId: null, visitCount: null };
    const result = await createVisitSeriesAction(empty, data);
    return { status: result.status, message: result.message, fieldErrors: result.fieldErrors, orderId: null };
  }, initialState);
  const [mode, setMode] = useState<"single" | "repeat" | "dates">("single");
  const [singleDate, setSingleDate] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(() => { const value = new Date(`${today()}T00:00:00Z`); value.setUTCMonth(value.getUTCMonth() + 2); return value.toISOString().slice(0, 10); });
  const [unit, setUnit] = useState<VisitRecurrenceUnit>("month");
  const [interval, setInterval] = useState(1);
  const [datePage, setDatePage] = useState(0);
  const [scope, setScope] = useState("common");
  const [validationError, setValidationError] = useState("");
  const [copyContact, setCopyContact] = useState(Boolean(order.contactId));
  const [copyObjects, setCopyObjects] = useState(true);
  const [masterNames, setMasterNames] = useState<Record<string, string>>({});
  const firstVisit = visits.find((visit) => visit.statusCode === "planned" || visit.statusCode === "confirmed");
  const [common, setCommon] = useState<Configuration>(() => ({ masterId: order.assignedMasterId ?? "", masterPayment: "", schedule: false, arrivalMode: firstVisit?.arrivalMode ?? "fixed", startTime: visitTime(firstVisit?.scheduledStartAt), endTime: firstVisit ? visitTime(firstVisit.scheduledEndAt) : "12:00", notes: order.notes ?? "", visitNotes: firstVisit?.notes ?? order.notes ?? "", expenseIds: [], rows: order.services.map((row) => ({ id: row.id, sourceId: row.id, enabled: true, catalogItemId: row.catalogItemId ?? null, name: row.name, kind: row.kind ?? "service", unit: row.unit ?? "усл.", quantity: String(row.quantity), unitPrice: row.pricePending ? "" : (row.unitPriceMinor / 100).toFixed(2) })) }));
  const [overrides, setOverrides] = useState<Record<string, Partial<Configuration>>>({});
  const recurrence = useMemo(() => { try { return { dates: generateVisitRecurrenceDates(startsOn, endsOn, unit, interval), error: "" }; } catch { return { dates: [] as string[], error: "Проверьте период и интервал." }; } }, [startsOn, endsOn, unit, interval]);
  const dates = mode === "single" ? singleDate ? [singleDate] : [] : mode === "dates" ? [...selectedDates].sort() : recurrence.dates;
  const pageCount = Math.max(1, Math.ceil(dates.length / 4));
  const currentPage = Math.min(datePage, pageCount - 1);
  const pageDates = dates.slice(currentPage * 4, currentPage * 4 + 4);
  const activeScope = mode === "single" || !dates.includes(scope) ? "common" : scope;
  const configFor = (date: string) => mode === "single" ? common : ({ ...common, ...overrides[date] });
  const current = activeScope === "common" ? common : configFor(activeScope);
  const change = (patch: Partial<Configuration>) => activeScope === "common" ? setCommon((previous) => ({ ...previous, ...patch })) : setOverrides((previous) => ({ ...previous, [activeScope]: { ...previous[activeScope], ...patch } }));
  const masterName = (id: string) => id ? masterNames[id] ?? options.masters.find((master) => master.id === id)?.name ?? (id === order.assignedMasterId ? order.master : null) ?? "Выбранный мастер" : "Без мастера";
  const dateOverrides = dates.map((date) => { const config = configFor(date); const enabled = config.rows.filter((row) => row.enabled); return { date, assignedMasterId: config.masterId || null, ...(canWriteFinance ? { masterPayment: config.masterId && config.masterPayment ? config.masterPayment : null, ...(!isSeries ? { expenseIds: config.expenseIds } : {}) } : {}), serviceIds: enabled.flatMap((row) => row.sourceId ? [row.sourceId] : []), serviceChanges: enabled.flatMap((row) => row.sourceId ? [{ id: row.sourceId, quantity: row.quantity, unitPrice: row.unitPrice }] : []), extraServices: enabled.filter((row) => !row.sourceId).map((row) => ({ catalogItemId: row.catalogItemId ?? null, name: row.name, kind: row.kind ?? "service", unit: row.unit, quantity: row.quantity.replace(",", "."), unitPrice: row.unitPrice })), ...(!isSeries ? { notes: config.notes } : {}), ...(canScheduleVisit && (isSeries || config.schedule) ? { arrivalMode: config.arrivalMode, startTime: config.startTime, ...(config.arrivalMode === "window" ? { endTime: config.endTime } : {}), visitNotes: config.visitNotes } : {}) }; });
  const enabledRows = current.rows.filter((row) => row.enabled);
  useEffect(() => {
    if (state.status !== "success") return;
    onClose();
    if (isSeries) router.refresh();
    else if (state.orderId) router.push(`/orders/${state.orderId}`);
  }, [router, onClose, isSeries, state.status, state.orderId]);

  return <form action={action} onSubmit={(event) => {
    setValidationError("");
    if (dates.length > limit || mode === "repeat" && Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${startsOn}T00:00:00Z`) > 366 * 86400000) {
      event.preventDefault(); setValidationError(`Выберите до ${limit} дат в пределах одного года.`); return;
    }
    for (const date of dates) {
      const config = configFor(date);
      const selected = config.rows.filter((row) => row.enabled);
      let error = "";
      if ((isSeries || config.schedule) && (!config.startTime || config.arrivalMode === "window" && (!config.endTime || config.endTime === config.startTime))) error = "Укажите время выезда. Начало и конец интервала должны различаться.";
      for (const row of selected) {
        try {
          parseQuantityToMilliunits(row.quantity);
          if (row.unitPrice !== "") parseMoneyToMinorUnits(row.unitPrice);
          if (row.name.trim().length < 2) error = "Укажите название позиции.";
        } catch { error = "Проверьте количество и цену позиций заказа."; }
      }
      if (config.notes.length > 4000 || config.visitNotes.length > 4000) error = "Сократите заметку до 4000 символов.";
      if (error) {
        event.preventDefault();
        setScope(mode === "single" ? "common" : date);
        setDatePage(Math.floor(dates.indexOf(date) / 4));
        setValidationError(`${dateLabel(date)}: ${error}`);
        return;
      }
    }
  }} className="flex flex-1 flex-col" data-testid="order-copy-form">
    <input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="sourceOrderId" value={order.id} /><input type="hidden" name="expectedVersion" value={order.version} /><input type="hidden" name="copyDate" value={dates[0] ?? ""} /><input type="hidden" name="copyDates" value={JSON.stringify(mode === "single" ? [] : dates)} /><input type="hidden" name="dateOverrides" value={JSON.stringify(dateOverrides)} /><input type="hidden" name="serviceIds" value="[]" /><input type="hidden" name="expenseIds" value="[]" /><input type="hidden" name="visitIds" value="[]" /><input type="hidden" name="copyMaster" value="false" /><input type="hidden" name="copyNotes" value="false" /><input type="hidden" name="copyContact" value={String(copyContact)} /><input type="hidden" name="copyRelatedObjects" value={String(copyObjects)} />
    <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="expectedOrderVersion" value={order.version} />
    <input type="hidden" name="scheduleMode" value={mode === "repeat" ? "interval" : "dates"} /><input type="hidden" name="selectedDates" value={JSON.stringify(dates)} />
    <input type="hidden" name="startsOn" value={dates[0] ?? startsOn} /><input type="hidden" name="endsOn" value={dates.at(-1) ?? endsOn} />
    <input type="hidden" name="frequencyUnit" value={unit} /><input type="hidden" name="frequencyInterval" value={interval} />
    <input type="hidden" name="localTime" value={common.startTime} /><input type="hidden" name="endTime" value={common.arrivalMode === "window" ? common.endTime : ""} />
    <input type="hidden" name="arrivalMode" value={common.arrivalMode} /><input type="hidden" name="durationMinutes" value="120" />
    <input type="hidden" name="assignedMasterId" value={common.masterId} /><input type="hidden" name="notes" value={common.visitNotes} />
    <div className="space-y-5 p-5 sm:p-7">
      <div role="group" aria-label="Что создать" className="grid gap-2 sm:grid-cols-2">{([["copy", "Копия заказа", "Создать новый заказ", Copy], ["series", "Серия выездов", `Добавить выезды к ${order.number}`, CalendarRange]] as const).map(([value, label, description, Icon]) => <button key={value} type="button" disabled={pending || value === "series" && (!canScheduleVisit || !order.objectId)} aria-pressed={target === value} onClick={() => { setTarget(value); setScope("common"); setDatePage(0); setValidationError(""); if (value === "series" && mode === "single") setMode("repeat"); }} className={`focus-ring flex min-h-20 items-center gap-3 rounded-2xl border p-4 text-left disabled:opacity-40 ${target === value ? "border-[var(--text)] bg-[var(--surface-inset)]" : "border-[var(--line)]"}`}><Icon className="size-5 shrink-0" /><span><span className="block text-sm font-semibold">{label}</span><span className="mt-1 block text-xs text-[var(--muted)]">{description}</span></span></button>)}</div>
      <div role="group" aria-label="Способ выбора дат" className="grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-inset)] p-1">{([["single", "Одна дата"], ["repeat", "По интервалу"], ["dates", "Выбрать даты"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { setMode(value); setScope("common"); setDatePage(0); }} className={`focus-ring min-h-11 rounded-lg px-2 text-xs font-medium ${mode === value ? "bg-[var(--text)] text-[var(--canvas)]" : "text-[var(--muted)]"}`}>{label}</button>)}</div>
      {mode === "single" ? <OrderField label={isSeries ? "Дата выезда" : "Дата новой копии"} required><DateInput name="singleCopyDate" value={singleDate} onChange={setSingleDate} required /></OrderField> : mode === "dates" ? <MultiDateCalendar dates={selectedDates} onChange={setSelectedDates} minDate={today()} maxDate={new Date(Date.parse(`${today()}T00:00:00Z`) + 365 * 86400000).toISOString().slice(0, 10)} limit={limit} showSelectedDates={false} /> : <div className="grid gap-4 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-2"><OrderField label="Первая дата"><DateInput name="startsOn" value={startsOn} onChange={setStartsOn} required /></OrderField><OrderField label="Окончание серии"><DateInput name="endsOn" value={endsOn} onChange={setEndsOn} required /></OrderField><OrderPicker searchable={false} label="Повторять" value={unit} onChange={(value) => setUnit(value as VisitRecurrenceUnit)} options={[{ value: "week", label: "Каждые N недель" }, { value: "month", label: "Каждые N месяцев" }]} placeholder="Выберите период" /><OrderField label="Интервал"><input type="number" min="1" max="12" value={interval} onChange={(event) => setInterval(Number(event.target.value))} className={orderInputClass} /></OrderField>{recurrence.error ? <p role="alert" className="text-sm text-[var(--danger)] sm:col-span-2">{recurrence.error}</p> : null}</div>}
      {mode !== "single" ? <section aria-label="Настройки по датам" className="overflow-hidden rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3"><h2 className="text-sm font-semibold">{isSeries ? "Выезды по датам" : "Копии по датам"}</h2><span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-xs">{dates.length}</span></div>
        <div className="space-y-3 p-4">
          <button type="button" aria-pressed={activeScope === "common"} onClick={() => setScope("common")} className={`focus-ring flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 text-left ${activeScope === "common" ? "border-[var(--text)] bg-[var(--surface-inset)]" : "border-[var(--line)]"}`}><span className="text-sm font-semibold">Общие настройки</span><span className="text-xs text-[var(--muted)]">Для всех дат</span></button>
          <div className="grid gap-2 sm:grid-cols-2">{pageDates.map(date => { const config = configFor(date); return <button key={date} type="button" aria-label={`Настроить ${isSeries ? "выезд" : "заказ"} на ${dateLabel(date)}`} aria-pressed={activeScope === date} onClick={() => setScope(date)} className={`focus-ring min-w-0 rounded-xl border p-3 text-left ${activeScope === date ? "border-[var(--text)] bg-[var(--surface-inset)]" : "border-[var(--line)]"}`}><span className="block text-sm font-medium">{dateLabel(date)}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{masterName(config.masterId)} · {isSeries || config.schedule ? config.arrivalMode === "fixed" ? `Точно ${config.startTime}` : `${config.startTime}–${config.endTime}` : "Без выезда"}</span><span className="mt-1 block text-xs text-[var(--muted)]">{overrides[date] ? "Свои настройки" : "Общие настройки"}</span></button>; })}</div>
          {!dates.length ? <p className="py-3 text-sm text-[var(--muted)]">Выберите даты выше.</p> : null}
        </div>
        {dates.length > 4 ? <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3"><span className="text-xs text-[var(--muted)]">{currentPage * 4 + 1}–{Math.min(dates.length, (currentPage + 1) * 4)} из {dates.length}</span><div className="flex gap-2"><button type="button" aria-label="Предыдущие даты" disabled={currentPage === 0} onClick={() => setDatePage(currentPage - 1)} className="focus-ring grid size-9 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] disabled:opacity-30"><ChevronLeft className="size-4" /></button><button type="button" aria-label="Следующие даты" disabled={currentPage === pageCount - 1} onClick={() => setDatePage(currentPage + 1)} className="focus-ring grid size-9 place-items-center rounded-lg border border-[var(--line)] bg-[var(--surface)] disabled:opacity-30"><ChevronRight className="size-4" /></button></div></div> : null}
      </section> : null}
      <section aria-label={isSeries ? "Параметры выездов" : "Параметры создаваемого заказа"} className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{mode === "single" ? isSeries ? "Параметры выезда" : "Параметры копии" : activeScope === "common" ? isSeries ? "Параметры для всех выездов" : "Параметры для всех заказов" : dateLabel(activeScope)}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{activeScope === "common" ? isSeries ? "Общие параметры выездов текущего заказа." : "Задайте состав и условия новых заказов." : "Измените нужные поля. Остальные следуют общим настройкам."}</p></div>{activeScope !== "common" && overrides[activeScope] ? <button type="button" onClick={() => setOverrides((previous) => { const next = { ...previous }; delete next[activeScope]; return next; })} className="focus-ring min-h-10 rounded-lg border border-[var(--line)] px-3 text-xs">Сбросить изменения</button> : null}</div>
        <OrderPicker label="Мастер" value={current.masterId || "none"} onChange={(value) => change({ masterId: value === "none" ? "" : value, masterPayment: "" })} onSelected={(option) => setMasterNames((previous) => ({ ...previous, [option.value]: option.label }))} pinnedValues={["none"]} remote={{ type: "masters" }} options={[{ value: "none", label: "Без мастера" }, ...(order.assignedMasterId && !options.masters.some((master) => master.id === order.assignedMasterId) ? [{ value: order.assignedMasterId, label: order.master ?? "Мастер исходного заказа" }] : []), ...options.masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} placeholder="Выберите мастера" searchPlaceholder="Имя или телефон" />
        {canWriteFinance && current.masterId ? <OrderField label="Выплата мастеру, ₽"><input aria-label="Выплата мастеру, ₽" value={current.masterPayment} onChange={(event) => change({ masterPayment: event.target.value })} inputMode="decimal" placeholder="Указать позже" className={orderInputClass} /></OrderField> : null}
        {canScheduleVisit ? <div className="space-y-3">{!isSeries ? <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={current.schedule} disabled={!order.objectId} onChange={(event) => change({ schedule: event.target.checked })} className="size-4 accent-[var(--accent)]" />Запланировать выезд</label> : null}{!order.objectId ? <p className="text-xs text-[var(--muted)]">Для выезда сначала добавьте объект в исходный заказ.</p> : null}{isSeries || current.schedule ? <><div role="group" aria-label="Время выезда" className="flex gap-2">{([["fixed", "Точное время"], ["window", "Интервал приезда"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={current.arrivalMode === value} onClick={() => change({ arrivalMode: value })} className={`focus-ring min-h-10 rounded-lg border px-3 text-xs ${current.arrivalMode === value ? "border-[var(--text)] bg-[var(--surface-inset)]" : "border-[var(--line)]"}`}>{label}</button>)}</div><div className="grid gap-3 sm:grid-cols-2"><OrderField label={current.arrivalMode === "fixed" ? "Время приезда" : "Начало интервала"} required><TimeInput key={`${activeScope}:start`} name="overrideStartTime" value={current.startTime} onChange={(value) => change({ startTime: value })} required /></OrderField>{current.arrivalMode === "window" ? <OrderField label="Конец интервала" required><TimeInput key={`${activeScope}:end`} name="overrideEndTime" value={current.endTime} onChange={(value) => change({ endTime: value })} required /></OrderField> : null}</div><OrderField label={isSeries ? "Заметка выезда" : "Инструкция для выезда"}><textarea aria-label={isSeries ? "Заметка выезда" : "Инструкция для выезда"} value={current.visitNotes} onChange={(event) => change({ visitNotes: event.target.value })} className={orderTextareaClass} /></OrderField></> : null}</div> : null}
        <section className="space-y-3"><h3 className="text-sm font-semibold">{isSeries ? "Состав выезда" : "Состав заказа"}</h3>{current.rows.map((row, index) => <div key={row.id} className="space-y-3 rounded-xl border border-[var(--line)] p-3"><div className="flex items-start gap-3"><input type="checkbox" aria-label={`Включить ${row.name}`} checked={row.enabled} onChange={(event) => change({ rows: current.rows.map((item) => item.id === row.id ? { ...item, enabled: event.target.checked } : item) })} className="mt-1 size-4 accent-[var(--accent)]" /><span className="min-w-0 flex-1 break-words text-sm font-medium">{row.name}</span>{!row.sourceId ? <button type="button" aria-label={`Удалить позицию ${index + 1}`} onClick={() => change({ rows: current.rows.filter((item) => item.id !== row.id) })} className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg"><Trash2 className="size-4" /></button> : null}</div>{row.enabled ? <div className="grid gap-3 sm:grid-cols-2"><OrderField label={`Количество позиции ${index + 1}`}><input aria-label={`Количество позиции ${index + 1}`} value={row.quantity} inputMode="decimal" onChange={(event) => change({ rows: current.rows.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item) })} className={orderInputClass} /><span className="text-xs text-[var(--muted)]">{row.unit}</span></OrderField><OrderField label={`Цена позиции ${index + 1}, ₽`}><input aria-label={`Цена позиции ${index + 1}, ₽`} value={row.unitPrice} inputMode="decimal" placeholder="Цена уточняется" onChange={(event) => change({ rows: current.rows.map((item) => item.id === row.id ? { ...item, unitPrice: event.target.value } : item) })} className={orderInputClass} /></OrderField></div> : null}</div>)}
          <ServiceChoice label="Добавить из справочника" allowCustom={false} value="" items={options.catalogItems ?? []} onChange={(_id, item) => { if (item) { const choice = resolveServiceChoice(item, order.objectAreaSquareMeters); change({ rows: [...current.rows, { id: clientCrypto.randomUUID(), sourceId: null, enabled: true, catalogItemId: item.id, name: item.name, kind: item.kind, unit: item.unit, quantity: choice.quantity, unitPrice: choice.unitPrice }] }); } }} />
          <button type="button" onClick={() => change({ rows: [...current.rows, { id: clientCrypto.randomUUID(), sourceId: null, enabled: true, catalogItemId: null, name: "Своя услуга", kind: "service", unit: "усл.", quantity: "1", unitPrice: "" }] })} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-xs"><Plus className="size-4" />Своя позиция</button>
          {current.rows.filter((row) => !row.sourceId && !row.catalogItemId).map((row) => <OrderField key={row.id} label="Название своей позиции"><input value={row.name} onChange={(event) => change({ rows: current.rows.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item) })} className={orderInputClass} /></OrderField>)}
          <p className="text-sm font-semibold">Итого: {enabledRows.length && enabledRows.every((row) => row.unitPrice !== "") ? formatMoneyMinor(enabledRows.reduce((total, row) => total + rowTotal(row), 0)) : "Цена уточняется"}</p>
        </section>
        {!isSeries ? <OrderField label="Заметка заказа"><textarea aria-label="Заметка заказа" value={current.notes} onChange={(event) => change({ notes: event.target.value })} placeholder="Можно изменить или удалить текст исходной заметки" className={orderTextareaClass} /></OrderField> : null}
        {!isSeries && canWriteFinance && order.expenses.length ? <FormDisclosure title="Перенести расходы" detail={`Выбрано ${current.expenseIds.length} из ${order.expenses.length}`} icon={<ReceiptText className="size-4" />}>{order.expenses.map(expense => <label key={expense.id} className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={current.expenseIds.includes(expense.id)} onChange={event => change({ expenseIds: event.target.checked ? [...current.expenseIds, expense.id] : current.expenseIds.filter(id => id !== expense.id) })} className="size-4 accent-[var(--accent)]" />{expense.category} · {formatMoneyMinor(expense.amountMinor)}</label>)}</FormDisclosure> : null}
      </section>
      {!isSeries && (order.contactId || (order.relatedObjects?.length ?? 0) > 1) ? <FormDisclosure title="Связи с клиентом и объектами" detail="Выберите, что перенести в копию" icon={<Link2 className="size-4" />}>{order.contactId ? <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={copyContact} onChange={event => setCopyContact(event.target.checked)} className="size-4 accent-[var(--accent)]" />Перенести контакты заказчика</label> : null}{(order.relatedObjects?.length ?? 0) > 1 ? <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={copyObjects} onChange={event => setCopyObjects(event.target.checked)} className="size-4 accent-[var(--accent)]" />Перенести дополнительные объекты</label> : null}</FormDisclosure> : null}
      <p className="text-xs leading-5 text-[var(--muted)]">{isSeries ? `Выезды будут добавлены к заказу ${order.number}. Состав и стоимость работ сохраняются для каждого выезда.` : `${dates.length} новых заказов. Оплаты, счета, документы и история исходного заказа не переносятся.`}</p>
      {validationError ? <p role="alert" className="text-sm text-[var(--danger-ink)]">{validationError}</p> : null}
      <OrderFormStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel={isSeries ? `Добавить ${countLabel(dates.length, ["выезд", "выезда", "выездов"])}` : mode === "single" ? "Создать копию" : `Создать ${countLabel(dates.length, ["заказ", "заказа", "заказов"])}`} disabled={!dates.length || dates.length > limit || isSeries && (!canScheduleVisit || !order.objectId)} />
  </form>;
}
