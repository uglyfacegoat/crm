"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import { Check, History, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";
import { createContractAction, getContractHistoryAction, renewContractAction, updateContractAction, type ContractActionState } from "@/app/(workspace)/contracts/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { ContractHistoryEvent, ContractListItem, ContractMasterOption, ContractObjectOption } from "@/server/contracts/types";

const initialState: ContractActionState = { status: "idle", message: null, fieldErrors: {}, contractId: null };
const statusLabels = { draft: "Черновик", active: "Действует", suspended: "Приостановлен", completed: "Завершён", cancelled: "Отменён" } as const;
const inputClass = "focus-ring h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3.5 text-sm text-[var(--text)] outline-none";
const fieldLabelClass = "grid gap-2 text-[10px] text-[var(--text-secondary)]";

function FieldError({ errors }: { errors?: string[] }) {
  return errors?.length ? <span className="text-[10px] text-[var(--danger-ink)]">{errors[0]}</span> : null;
}

function ResultMessage({ state }: { state: ContractActionState }) {
  return state.message ? <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p> : null;
}

function SubmitFooter({ pending, success, label, onClose }: { pending: boolean; success: boolean; label: string; onClose: () => void }) {
  return <footer className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4 sm:px-7"><button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-[var(--line)] text-xs text-[var(--text-secondary)]">Отмена</button><button type="submit" disabled={pending || success} className="focus-ring flex h-12 flex-[1.5] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[var(--on-accent)] disabled:opacity-65">{pending ? <><LoaderCircle className="size-4 animate-spin" />Сохраняем…</> : success ? <><Check className="size-4" />Сохранено</> : label}</button></footer>;
}

function useCloseAfterSuccess(state: ContractActionState, onClose: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onClose, 700);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, state.status]);
}

function CreateContractForm({ objectOptions, masterOptions, onClose }: { objectOptions: ContractObjectOption[]; masterOptions: ContractMasterOption[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(createContractAction, initialState);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [objectId, setObjectId] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const selectedObject = objectOptions.find((option) => option.id === objectId);
  useCloseAfterSuccess(state, onClose);
  return <form action={action} className="flex flex-1 flex-col">
    <input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="clientId" value={selectedObject?.clientId ?? ""} />
    <div className="flex-1 space-y-6 p-5 sm:p-7">
      <section className="space-y-4"><p className="eyebrow">Основание</p>
        <label className={fieldLabelClass}><span>Клиент и объект *</span><select name="objectId" value={objectId} onChange={(event) => setObjectId(event.target.value)} required className={inputClass}><option value="">Выберите объект</option>{objectOptions.map((option) => <option key={option.id} value={option.id}>{option.clientName} · {option.name} · {option.address}</option>)}</select><FieldError errors={state.fieldErrors.objectId ?? state.fieldErrors.clientId} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className={fieldLabelClass}><span>Номер договора *</span><input name="contractNumber" required maxLength={120} placeholder="Д-2026/014" className={inputClass} /><FieldError errors={state.fieldErrors.contractNumber} /></label><label className={fieldLabelClass}><span>Стартовый статус</span><select name="status" defaultValue="active" className={inputClass}><option value="active">Действует</option><option value="draft">Черновик</option></select></label></div>
      </section>
      <section className="space-y-4"><p className="eyebrow">Неизменяемый период</p><div className="grid gap-4 sm:grid-cols-2"><label className={fieldLabelClass}><span>Начало *</span><DateInput name="startsOn" required className={inputClass} /><FieldError errors={state.fieldErrors.startsOn} /></label><label className={fieldLabelClass}><span>Окончание *</span><DateInput name="endsOn" required className={inputClass} /><FieldError errors={state.fieldErrors.endsOn} /></label></div><label className={fieldLabelClass}><span>Напомнить о продлении за, дней</span><input type="number" name="renewalNoticeDays" min={1} max={365} defaultValue={30} className={inputClass} /></label></section>
      <section className="rounded-[15px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"><label className="flex min-h-11 cursor-pointer items-center gap-3"><input type="checkbox" name="scheduleEnabled" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} className="size-4 accent-[var(--accent)]" /><span className="min-w-0 flex-1"><strong className="block text-xs text-[var(--text)]">Сразу создать плановые выезды</strong><span className="mt-1 block text-[10px] leading-4 text-[var(--muted)]">Даты попадут в общий календарь и создадут задачи подготовки.</span></span></label>{scheduleEnabled ? <div className="mt-4 grid gap-4 border-t border-[var(--line)] pt-4 sm:grid-cols-2"><label className={fieldLabelClass}><span>Повтор</span><select name="frequencyUnit" defaultValue="month" className={inputClass}><option value="month">По месяцам</option><option value="week">По неделям</option></select></label><label className={fieldLabelClass}><span>Каждые</span><input type="number" name="frequencyInterval" min={1} max={12} defaultValue={1} className={inputClass} /></label><label className={fieldLabelClass}><span>Время</span><TimeInput name="localTime" defaultValue="10:00" className={inputClass} /></label><label className={fieldLabelClass}><span>Длительность, минут</span><input type="number" name="durationMinutes" min={15} max={1440} step={15} defaultValue={120} className={inputClass} /></label><label className={`${fieldLabelClass} sm:col-span-2`}><span>Мастер по умолчанию</span><select name="defaultMasterId" defaultValue="" className={inputClass}><option value="">Назначить позже</option>{masterOptions.map((master) => <option key={master.id} value={master.id}>{master.name} · {master.region}</option>)}</select><FieldError errors={state.fieldErrors.defaultMasterId} /></label></div> : <><input type="hidden" name="frequencyUnit" value="month" /><input type="hidden" name="frequencyInterval" value="1" /><input type="hidden" name="localTime" value="10:00" /><input type="hidden" name="durationMinutes" value="120" /><input type="hidden" name="defaultMasterId" value="" /></>}</section>
      <label className={fieldLabelClass}><span>Условия и заметки</span><textarea name="notes" maxLength={4000} rows={4} placeholder="Состав регулярных работ, доступ, ограничения" className="focus-ring resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" /></label><ResultMessage state={state} />
    </div><SubmitFooter pending={pending} success={state.status === "success"} label="Создать договор" onClose={onClose} />
  </form>;
}

function EditContractForm({ contract, onClose }: { contract: ContractListItem; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateContractAction, initialState);
  useCloseAfterSuccess(state, onClose);
  const periodLocked = contract.status !== "draft" || Boolean(contract.schedule?.visitCount);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="contractId" value={contract.id} /><input type="hidden" name="expectedVersion" value={contract.version} /><div className="flex-1 space-y-5 p-5 sm:p-7"><label className={fieldLabelClass}><span>Номер договора</span><input name="contractNumber" defaultValue={contract.contractNumber} required className={inputClass} /></label><label className={fieldLabelClass}><span>Статус</span><select name="status" defaultValue={contract.status} className={inputClass}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className={fieldLabelClass}><span>Начало</span><DateInput name="startsOn" defaultValue={contract.startsOn} readOnly={periodLocked} className={`${inputClass} read-only:cursor-not-allowed read-only:opacity-55`} /></label><label className={fieldLabelClass}><span>Окончание</span><DateInput name="endsOn" defaultValue={contract.endsOn} readOnly={periodLocked} className={`${inputClass} read-only:cursor-not-allowed read-only:opacity-55`} /></label></div>{periodLocked ? <p className="rounded-[12px] border border-[var(--support-strong)] bg-[var(--support-soft)] p-3 text-[10px] leading-5 text-[var(--support-strong)]">Период зафиксирован. Новый срок оформляется через продление, поэтому старые выезды и отчёты не изменятся.</p> : null}<label className={fieldLabelClass}><span>Напомнить за, дней</span><input type="number" name="renewalNoticeDays" min={1} max={365} defaultValue={contract.renewalNoticeDays} className={inputClass} /></label><label className={fieldLabelClass}><span>Условия и заметки</span><textarea name="notes" maxLength={4000} rows={5} defaultValue={contract.notes ?? ""} className="focus-ring resize-none rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] p-3.5 text-sm leading-6 text-[var(--text)] outline-none" /></label><label className={fieldLabelClass}><span>Причина изменения статуса</span><input name="reason" maxLength={1000} placeholder="Необязательно, но останется в истории" className={inputClass} /></label><ResultMessage state={state} /></div><SubmitFooter pending={pending} success={state.status === "success"} label="Сохранить изменения" onClose={onClose} /></form>;
}

function addDay(date: string) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
function addYear(date: string) { const value = new Date(`${date}T12:00:00Z`); value.setUTCFullYear(value.getUTCFullYear() + 1); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10); }

function RenewContractForm({ contract, onClose }: { contract: ContractListItem; onClose: () => void }) {
  const [state, action, pending] = useActionState(renewContractAction, initialState);
  const [requestKey] = useState(() => crypto.randomUUID());
  const startsOn = addDay(contract.endsOn);
  useCloseAfterSuccess(state, onClose);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="sourceContractId" value={contract.id} /><input type="hidden" name="expectedVersion" value={contract.version} /><div className="flex-1 space-y-5 p-5 sm:p-7"><div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"><p className="text-xs font-semibold text-[var(--text)]">{contract.contractNumber}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{contract.clientName} · {contract.objectName}</p><p className="mt-3 text-[10px] text-[var(--text-secondary)]">Старый период останется в истории без изменений.</p></div><label className={fieldLabelClass}><span>Новый номер договора *</span><input name="contractNumber" required placeholder={`${contract.contractNumber}-П1`} className={inputClass} /></label><div className="grid gap-4 sm:grid-cols-2"><label className={fieldLabelClass}><span>Новый период с</span><DateInput name="startsOn" defaultValue={startsOn} className={inputClass} /></label><label className={fieldLabelClass}><span>По</span><DateInput name="endsOn" defaultValue={addYear(startsOn)} className={inputClass} /></label></div><label className={fieldLabelClass}><span>Напомнить за, дней</span><input type="number" name="renewalNoticeDays" min={1} max={365} defaultValue={contract.renewalNoticeDays} className={inputClass} /></label><label className={`flex min-h-14 items-center gap-3 rounded-[13px] border border-[var(--line)] p-3.5 ${contract.schedule ? "cursor-pointer" : "opacity-50"}`}><input type="checkbox" name="copySchedule" defaultChecked={Boolean(contract.schedule)} disabled={!contract.schedule} className="size-4 accent-[var(--accent)]" /><span><strong className="block text-xs text-[var(--text)]">Перенести график работ</strong><span className="mt-1 block text-[10px] text-[var(--muted)]">Создать даты выездов для нового периода</span></span></label><ResultMessage state={state} /></div><SubmitFooter pending={pending} success={state.status === "success"} label="Создать продление" onClose={onClose} /></form>;
}

const eventLabels = { created: "Договор создан", updated: "Данные изменены", status_changed: "Статус изменён", renewed: "Создано продление" } as const;
function HistoryContent({ contractId }: { contractId: string }) {
  const [events, setEvents] = useState<ContractHistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void getContractHistoryAction(contractId).then((result) => { if (!active) return; if (result.status === "success") setEvents(result.events); else setError(result.message); }); return () => { active = false; }; }, [contractId]);
  if (error) return <p className="m-5 rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-4 text-xs text-[var(--danger-ink)] sm:m-7">{error}</p>;
  if (!events) return <div className="flex items-center justify-center gap-2 p-10 text-xs text-[var(--muted)]"><LoaderCircle className="size-4 animate-spin" />Загружаем историю…</div>;
  return <ol className="space-y-3 p-5 sm:p-7">{events.map((event) => <li key={event.id} className="rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent-ink)]">{event.eventType === "renewed" ? <RefreshCw className="size-3.5" /> : <History className="size-3.5" />}</span><div className="min-w-0 flex-1"><p className="text-xs font-medium text-[var(--text)]">{eventLabels[event.eventType]}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{event.actorName ?? "Система"} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</p></div></div>{event.reason ? <p className="mt-3 border-l border-[var(--accent)] pl-3 text-[10px] leading-5 text-[var(--text-secondary)]">{event.reason}</p> : null}</li>)}</ol>;
}

export type ContractDialogMode = "create" | "edit" | "renew" | "history" | null;

export function ContractDialogs({ mode, contract, objectOptions, masterOptions, onClose }: { mode: ContractDialogMode; contract: ContractListItem | null; objectOptions: ContractObjectOption[]; masterOptions: ContractMasterOption[]; onClose: () => void }) {
  const title = useMemo(() => mode === "create" ? "Новый договор" : mode === "edit" ? "Редактировать договор" : mode === "renew" ? "Продлить договор" : "История договора", [mode]);
  return <Dialog open={mode !== null} onClose={onClose} title={title} description={mode === "create" ? "Договор, график и все даты выездов сохранятся одной транзакцией." : contract ? `${contract.contractNumber} · ${contract.clientName}` : undefined}>{mode === "create" ? <CreateContractForm objectOptions={objectOptions} masterOptions={masterOptions} onClose={onClose} /> : mode === "edit" && contract ? <EditContractForm contract={contract} onClose={onClose} /> : mode === "renew" && contract ? <RenewContractForm contract={contract} onClose={onClose} /> : mode === "history" && contract ? <HistoryContent contractId={contract.id} /> : null}</Dialog>;
}

export function NewContractButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"><Plus className="size-4" />Новый договор</button>;
}
