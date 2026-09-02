"use client";

import { CalendarClock, Check, FileCheck2, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Repeat2, UserRound } from "lucide-react";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { createVisitAction, updateVisitAction, type CreateVisitState, type UpdateVisitState } from "@/app/(workspace)/calendar/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { VisitDurationPicker } from "@/components/visits/visit-form-parts";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { VisitCompletionForm } from "@/components/visits/visit-completion-form";
import { VisitHistoryButton } from "@/components/visits/visit-history-dialog";
import { VisitSeriesForm } from "@/components/visits/visit-series-form";
import type { OrderCreationOptions } from "@/server/orders/types";
import type { VisitHistoryFeed } from "@/server/visits/history";
import { visitStatusLabels, visitStatuses, type ServiceVisit, type VisitStatus } from "@/server/visits/types";
import { OrderField, OrderFormFooter, OrderFormStatus, orderInputClass, OrderPicker, orderTextareaClass } from "./order-form-parts";

const initialCreateState: CreateVisitState = { status: "idle", message: null, fieldErrors: {}, visitId: null };
const initialUpdateState: UpdateVisitState = { status: "idle", message: null, fieldErrors: {}, version: null };
const visitStatusStyles: Record<ServiceVisit["statusCode"], string> = {
  planned: "bg-[var(--accent)]/10 text-[var(--accent)]",
  confirmed: "bg-[#55d5ca]/10 text-[#75d8ce]",
  in_progress: "bg-[#9c82e8]/12 text-[#bcaaf2]",
  completed: "bg-[#63c99d]/10 text-[#74d9ac]",
  cancelled: "bg-[#ef646a]/10 text-[#ef858a]",
};
const editableVisitStatuses = visitStatuses.filter((status) => status !== "completed");

function localDateTime(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function formatVisitDate(visit: ServiceVisit) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(visit.scheduledStartAt));
}

function useCloseAfterSuccess(status: "idle" | "success" | "error", onClose: () => void) {
  useEffect(() => {
    if (status !== "success") return;
    const timeout = window.setTimeout(onClose, 550);
    return () => window.clearTimeout(timeout);
  }, [onClose, status]);
}

function CreateVisitForm({ orderId, requestKey, masters, defaultMasterId, onClose }: { orderId: string; requestKey: string; masters: OrderCreationOptions["masters"]; defaultMasterId: string | null; onClose: () => void }) {
  const [state, action, pending] = useActionState(createVisitAction, initialCreateState);
  const [masterId, setMasterId] = useState(defaultMasterId ?? "");
  const [duration, setDuration] = useState(120);
  useCloseAfterSuccess(state.status, onClose);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="orderId" value={orderId} /><input type="hidden" name="assignedMasterId" value={masterId} /><div className="flex-1 space-y-6 p-5 sm:p-7"><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Дата" required errors={state.fieldErrors.localDate}><input type="date" name="localDate" required className={orderInputClass} /></OrderField><OrderField label="Время" required errors={state.fieldErrors.localTime}><input type="time" name="localTime" required step="300" className={orderInputClass} /></OrderField></div><VisitDurationPicker value={duration} onChange={setDuration} /><OrderPicker label="Мастер" value={masterId} onChange={setMasterId} options={[{ value: "", label: "Не назначен" }, ...masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} placeholder="Не назначен" errors={state.fieldErrors.assignedMasterId} /><OrderField label="Заметка для выезда" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} placeholder="Подготовка, доступ, особенности работ…" className={orderTextareaClass} /></OrderField><p className="text-[10px] leading-4 text-[#667078]">Время сохраняется в часовом поясе компании. Пересечения выездов одного мастера блокируются сервером.</p><OrderFormStatus state={state} /></div><OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Создать выезд" /></form>;
}

function EditVisitForm({ visit, masters, onClose }: { visit: ServiceVisit; masters: OrderCreationOptions["masters"]; onClose: () => void }) {
  const initialLocal = localDateTime(visit.scheduledStartAt, visit.timezone);
  const initialDuration = Math.round((new Date(visit.scheduledEndAt).getTime() - new Date(visit.scheduledStartAt).getTime()) / 60_000);
  const [status, setStatus] = useState<VisitStatus>(visit.statusCode);
  const [masterId, setMasterId] = useState(visit.assignedMasterId ?? "");
  const [localDate, setLocalDate] = useState(initialLocal.date);
  const [localTime, setLocalTime] = useState(initialLocal.time);
  const [duration, setDuration] = useState(initialDuration);
  const [savedSchedule, setSavedSchedule] = useState({ date: initialLocal.date, time: initialLocal.time, duration: initialDuration });
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [version, setVersion] = useState(visit.version);
  const [savePhase, setSavePhase] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<number | null>(null);
  const queuedRef = useRef(false);
  const [state, action, pending] = useActionState(async (previousState: UpdateVisitState, formData: FormData) => {
    const result = await updateVisitAction(previousState, formData);
    if (result.status === "success" && result.version) {
      const submittedSchedule = {
        date: String(formData.get("localDate")),
        time: String(formData.get("localTime")),
        duration: Number(formData.get("durationMinutes")),
      };
      setVersion(result.version);
      setSavedSchedule(submittedSchedule);
      setSavePhase("saved");
      if (queuedRef.current) {
        queuedRef.current = false;
        window.setTimeout(() => {
          setSavePhase("saving");
          formRef.current?.requestSubmit();
        }, 80);
      } else {
        setRescheduleReason("");
      }
    } else if (result.status === "error") {
      setSavePhase("error");
    }
    return result;
  }, initialUpdateState);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  function requestSave() {
    const form = formRef.current;
    if (!form || !form.checkValidity()) { setSavePhase("dirty"); return; }
    if (pending) { queuedRef.current = true; return; }
    setSavePhase("saving");
    form.requestSubmit();
  }

  function scheduleSave() {
    setSavePhase("dirty");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(requestSave, 700);
  }

  function chooseStatus(value: VisitStatus) { setStatus(value); scheduleSave(); }
  function chooseMaster(value: string) { setMasterId(value); scheduleSave(); }
  function chooseDuration(value: number) { setDuration(value); scheduleSave(); }

  const visibleSavePhase = pending ? "saving" : savePhase;
  const scheduleChanged = localDate !== savedSchedule.date || localTime !== savedSchedule.time || duration !== savedSchedule.duration;

  return <form ref={formRef} action={action} onChangeCapture={scheduleSave} className="flex flex-1 flex-col"><input type="hidden" name="visitId" value={visit.id} /><input type="hidden" name="orderId" value={visit.orderId ?? ""} /><input type="hidden" name="expectedVersion" value={version} /><input type="hidden" name="status" value={status} /><input type="hidden" name="assignedMasterId" value={masterId} /><div className="flex-1 space-y-6 p-5 sm:p-7"><fieldset><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667077]">Статус</legend><div className="mt-3 grid grid-cols-2 gap-2">{editableVisitStatuses.map((value) => <button key={value} type="button" onClick={() => chooseStatus(value)} className={`focus-ring min-h-11 rounded-[11px] border px-2 text-[10px] ${status === value ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.07] text-white" : "border-white/[0.07] text-[#768087]"}`}>{visitStatusLabels[value]}</button>)}</div><p className="mt-2 text-[9px] leading-4 text-[#626c72]">Завершение выполняется отдельно: система потребует подписанный акт.</p></fieldset><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Дата" required errors={state.fieldErrors.localDate}><input type="date" name="localDate" required value={localDate} onChange={(event) => setLocalDate(event.target.value)} className={orderInputClass} /></OrderField><OrderField label="Время" required errors={state.fieldErrors.localTime}><input type="time" name="localTime" required step="300" value={localTime} onChange={(event) => setLocalTime(event.target.value)} className={orderInputClass} /></OrderField></div><VisitDurationPicker value={duration} onChange={chooseDuration} />{scheduleChanged ? <OrderField label="Причина переноса" required errors={state.fieldErrors.rescheduleReason}><textarea name="rescheduleReason" required minLength={3} maxLength={1000} value={rescheduleReason} onChange={(event) => setRescheduleReason(event.target.value)} placeholder="Например: клиент попросил изменить дату" className={orderTextareaClass} /><span className="text-[9px] leading-4 text-[#667078]">Сохранится отдельным событием и останется в истории выезда.</span></OrderField> : <input type="hidden" name="rescheduleReason" value="" />}<OrderPicker label="Мастер" value={masterId} onChange={chooseMaster} options={[{ value: "", label: "Не назначен" }, ...masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} placeholder="Не назначен" errors={state.fieldErrors.assignedMasterId} />{status === "cancelled" ? <OrderField label="Причина отмены" required errors={state.fieldErrors.cancellationReason}><textarea name="cancellationReason" required minLength={3} maxLength={1000} defaultValue={visit.cancellationReason ?? ""} className={orderTextareaClass} /></OrderField> : <input type="hidden" name="cancellationReason" value="" />}<OrderField label="Заметка" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} defaultValue={visit.notes ?? ""} className={orderTextareaClass} /></OrderField>{state.status === "error" ? <OrderFormStatus state={state} /> : null}</div><footer className="mt-auto flex shrink-0 items-center gap-3 border-t border-white/[0.07] bg-[#0d1317] p-4 sm:px-7"><div aria-live="polite" className="min-w-0 flex-1 text-xs">{visibleSavePhase === "saving" ? <span className="flex items-center gap-2 text-[#aab2b6]"><LoaderCircle className="size-4 animate-spin" />Сохранение…</span> : visibleSavePhase === "saved" ? <span className="flex items-center gap-2 text-[#83d4b2]"><Check className="size-4" />Сохранено</span> : visibleSavePhase === "error" ? <span className="text-[#df8c90]">Ошибка сохранения</span> : <span className="text-[#d1b86f]">Есть несохранённые изменения</span>}</div>{visibleSavePhase === "error" ? <button type="button" onClick={requestSave} className="focus-ring flex h-10 items-center gap-2 rounded-[11px] border border-white/[0.08] px-3 text-xs text-[#aeb6ba]"><RefreshCw className="size-3.5" />Повторить</button> : null}<button type="button" onClick={onClose} className="focus-ring h-10 rounded-[11px] border border-white/[0.08] px-4 text-xs text-[#aeb6ba]">Закрыть</button></footer></form>;
}

export function OrderVisitSection({ orderId, visits, history, masters, defaultMasterId, canWrite, canComplete, initialCreateKey = null }: { orderId: string; visits: ServiceVisit[]; history: VisitHistoryFeed; masters: OrderCreationOptions["masters"]; defaultMasterId: string | null; canWrite: boolean; canComplete: boolean; initialCreateKey?: string | null }) {
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [seriesKey, setSeriesKey] = useState<string | null>(null);
  const [completionVisitId, setCompletionVisitId] = useState<string | null>(null);
  const [completionKey, setCompletionKey] = useState<string | null>(null);
  const close = useCallback(() => { setActiveVisitId(null); setCreateKey(null); setSeriesKey(null); setCompletionVisitId(null); setCompletionKey(null); }, []);
  useEffect(() => {
    if (!initialCreateKey) return;
    const timeout = window.setTimeout(() => setCreateKey(initialCreateKey), 0);
    return () => window.clearTimeout(timeout);
  }, [initialCreateKey]);
  const activeVisit = visits.find((visit) => visit.id === activeVisitId) ?? null;
  const completionVisit = visits.find((visit) => visit.id === completionVisitId) ?? null;
  function openCompletion(visitId: string) { setCompletionVisitId(visitId); setCompletionKey(crypto.randomUUID()); }
  return <section className="surface-panel animate-rise" style={{ animationDelay: "140ms" }}>
    <div className="flex flex-col items-stretch gap-3 border-b border-white/[0.06] px-4 py-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between sm:px-6">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-white">Выезды</h2><p className="mt-1 truncate text-xs text-[#727b81]">{visits.length ? `${visits.length} в плане и истории` : "План и история работ по заказу"}</p></div>
      <div className="flex w-full min-w-0 gap-2 min-[480px]:w-auto min-[480px]:shrink-0"><VisitHistoryButton feed={history} visits={visits} />{canWrite ? <><button aria-label="Создать серию выездов" onClick={() => setSeriesKey(crypto.randomUUID())} className="focus-ring flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-[11px] border border-white/[0.08] px-2 text-xs text-[#aeb6ba] min-[480px]:flex-none min-[480px]:px-3"><Repeat2 className="size-3.5 shrink-0" /><span className="tiny-hidden">Серия</span></button><button aria-label="Добавить выезд" onClick={() => setCreateKey(crypto.randomUUID())} className="focus-ring flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-[11px] bg-[var(--accent)] px-2 text-xs font-semibold text-[#111509] min-[480px]:flex-none min-[480px]:px-3"><Plus className="size-3.5 shrink-0" /><span className="tiny-hidden">Добавить </span>выезд</button></> : null}</div>
    </div>
    {visits.length ? <div className="divide-y divide-white/[0.055]">{visits.map((visit) => {
      const terminal = visit.statusCode === "completed" || visit.statusCode === "cancelled";
      return <article key={visit.id} className="grid gap-4 px-4 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-center sm:px-6">
        <div><p className="font-display text-xs text-white">{formatVisitDate(visit)}</p><p className="mt-1 text-[10px] text-[#6d777d]">до {new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(visit.scheduledEndAt))}{visit.occurrenceNumber ? ` · серия #${visit.occurrenceNumber}` : ""}</p></div>
        <div className="min-w-0"><p className="flex items-center gap-2 truncate text-sm text-[#dfe3df]"><MapPin className="size-3.5 shrink-0 text-[#6f797f]" />{visit.address}</p><p className="mt-1 flex items-center gap-2 text-xs text-[#747d83]"><UserRound className="size-3.5" />{visit.master ?? "Мастер не назначен"}</p>{visit.completionNotes ? <p className="mt-1 truncate text-[10px] text-[#669b82]">{visit.completionNotes}</p> : null}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 sm:justify-end"><span className={`rounded-full px-2.5 py-1 text-[10px] ${visitStatusStyles[visit.statusCode]}`}>{visit.status}</span><VisitDispatchCardButton visitId={visit.id} compact />{visit.completionDocumentId ? <a href={`/api/v1/documents/${visit.completionDocumentId}/download`} aria-label={`Скачать закрывающий акт ${visit.completionDocumentTitle ?? ""}`} title={visit.completionDocumentTitle ?? "Скачать закрывающий акт"} className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[#63c99d]/20 bg-[#63c99d]/[0.05] text-[#74d9ac] hover:bg-[#63c99d]/10"><FileCheck2 className="size-3.5" /></a> : canComplete && !terminal ? <button type="button" onClick={() => openCompletion(visit.id)} aria-label={`Завершить выезд ${formatVisitDate(visit)} с актом`} title="Завершить с закрывающим актом" className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--accent)]/20 bg-[var(--accent)]/[0.045] text-[var(--accent)] hover:bg-[var(--accent)]/[0.08]"><FileCheck2 className="size-3.5" /></button> : null}{canWrite && visit.statusCode !== "completed" ? <button type="button" onClick={() => setActiveVisitId(visit.id)} aria-label={`Редактировать выезд ${formatVisitDate(visit)}`} className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#7b858b] hover:bg-white/[0.04]"><Pencil className="size-3.5" /></button> : null}</div>
      </article>;
    })}</div> : <div className="px-6 py-10 text-center"><CalendarClock className="mx-auto size-6 text-[#596268]" /><p className="mt-3 text-sm text-[#8d969b]">Выездов пока нет</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[#626c72]">Добавьте одну или несколько дат — каждая хранится отдельно и может иметь своего мастера и статус.</p></div>}
    <Dialog open={createKey !== null} onClose={close} title="Новый выезд" description="Дата привязывается к заказу и сразу появляется в календаре.">{createKey ? <CreateVisitForm orderId={orderId} requestKey={createKey} masters={masters} defaultMasterId={defaultMasterId} onClose={close} /> : null}</Dialog>
    <Dialog open={seriesKey !== null} onClose={close} title="Серия выездов" description="Создайте расписание по заказу сразу на срок до одного года.">{seriesKey ? <VisitSeriesForm orderId={orderId} requestKey={seriesKey} masters={masters} defaultMasterId={defaultMasterId} onClose={close} /> : null}</Dialog>
    <Dialog open={activeVisit !== null} onClose={close} title="Редактировать выезд" description="Версия проверяется перед сохранением, изменения попадают в историю.">{activeVisit ? <EditVisitForm visit={activeVisit} masters={masters} onClose={close} /> : null}</Dialog>
    <Dialog open={completionVisit !== null && completionKey !== null} onClose={close} title="Завершить выезд" description="Закрытие фиксируется вместе с обязательным актом и не может быть выполнено частично.">{completionVisit && completionKey ? <VisitCompletionForm visit={completionVisit} requestKey={completionKey} onClose={close} /> : null}</Dialog>
  </section>;
}
