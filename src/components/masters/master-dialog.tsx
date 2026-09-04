"use client";

import { Check, Plus, UserRoundPen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useState } from "react";
import {
  createMasterAction,
  type MasterMutationState,
  updateMasterAction,
} from "@/app/(workspace)/masters/actions";
import { OrderField, OrderFormFooter, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { DateInput } from "@/components/ui/date-time-inputs";
import { clientCrypto as crypto } from "@/lib/client-id";
import type { MasterListItem, MasterOperationalStatus } from "@/server/masters/types";

const initialState: MasterMutationState = { status: "idle", message: null, fieldErrors: {} };

function MutationStatus({ state }: { state: MasterMutationState }) {
  if (!state.message) return null;
  return <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#b8f7e4]/20 bg-[#b8f7e4]/[0.05] text-[#8ed7b8]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#d89599]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p>;
}

function MasterFields({ state, master }: { state: MasterMutationState; master?: MasterListItem }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <OrderField label="ФИО" required errors={state.fieldErrors.fullName}><input name="fullName" required minLength={2} maxLength={200} defaultValue={master?.fullName} placeholder="Иванов Иван Иванович" className={orderInputClass} /></OrderField>
    <OrderField label="Телефон" required errors={state.fieldErrors.phone}><input name="phone" required inputMode="tel" minLength={7} maxLength={40} defaultValue={master?.phone} placeholder="+7 999 000-00-00" className={orderInputClass} /></OrderField>
    <OrderField label="Мессенджер" errors={state.fieldErrors.messenger}><input name="messenger" maxLength={120} defaultValue={master?.messenger ?? ""} placeholder="@username или WhatsApp" className={orderInputClass} /></OrderField>
    <OrderField label="Базовая выплата, ₽" required errors={state.fieldErrors.basePaymentMinor}><input name="basePayment" required inputMode="decimal" defaultValue={master?.basePaymentMinor === null || master?.basePaymentMinor === undefined ? "" : String(master.basePaymentMinor / 100)} placeholder="4 000" className={orderInputClass} /></OrderField>
    <OrderField label="Регион" required errors={state.fieldErrors.serviceRegion}><input name="serviceRegion" required minLength={2} maxLength={160} defaultValue={master?.serviceRegion} placeholder="Москва" className={orderInputClass} /></OrderField>
    <OrderField label="Зона обслуживания" required errors={state.fieldErrors.serviceZone}><input name="serviceZone" required maxLength={160} defaultValue={master?.serviceZone} placeholder="ЦАО, САО или радиус" className={orderInputClass} /></OrderField>
    <OrderField label="Лимит выездов в день" required errors={state.fieldErrors.dailyCapacity}><input name="dailyCapacity" type="number" required min={1} max={20} defaultValue={master?.dailyCapacity ?? 4} className={orderInputClass} /></OrderField>
    <OrderField label="Специализации через запятую" errors={state.fieldErrors.skills}><input name="skills" maxLength={1500} defaultValue={master?.skills.join(", ") ?? ""} placeholder="Дератизация, дезинсекция" className={orderInputClass} /></OrderField>
    <div className="sm:col-span-2"><OrderField label="Заметка для офиса" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} defaultValue={master?.notes ?? ""} placeholder="Допуски, особенности зоны, рабочий график" className={orderTextareaClass} /></OrderField></div>
  </div>;
}

const workDays = [[1, "Пн"], [2, "Вт"], [3, "Ср"], [4, "Чт"], [5, "Пт"], [6, "Сб"], [7, "Вс"]] as const;
const operationalStatuses: Array<{ value: MasterOperationalStatus; label: string; note: string }> = [
  { value: "working", label: "Работает", note: "Доступен для новых назначений" },
  { value: "vacation", label: "В отпуске", note: "Недоступен до указанной даты" },
  { value: "unavailable", label: "Временно не работает", note: "Больничный, выходной или ЧП" },
  { value: "terminated", label: "Уволен", note: "Остаётся только в истории" },
];

function MasterAvailabilityFields({ state, master }: { state: MasterMutationState; master?: MasterListItem }) {
  const initialStatus = master?.operationalStatus ?? "working";
  return <section className="overflow-hidden border border-white/[0.09] bg-[#202227]">
    <div className="grid gap-px bg-white/[0.08] lg:grid-cols-[0.9fr_1.1fr]">
      <fieldset className="bg-[var(--surface)] p-5"><legend className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8d9694]">Статус мастера</legend><div className="mt-4 divide-y divide-white/[0.07]">{operationalStatuses.map((status) => <label key={status.value} className="group grid cursor-pointer grid-cols-[1rem_minmax(0,1fr)] gap-3 py-3"><input type="radio" name="operationalStatus" value={status.value} defaultChecked={initialStatus === status.value} className="peer mt-1 size-3.5 appearance-none rounded-full border border-white/20 checked:border-[5px] checked:border-[var(--accent)]" /><span><strong className="block text-xs font-medium text-[#dfe5e3] peer-checked:text-white">{status.label}</strong><span className="mt-1 block text-[9px] text-[#747d7b]">{status.note}</span></span></label>)}</div></fieldset>
      <fieldset className="bg-[var(--surface)] p-5"><legend className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#8d9694]">Рабочая неделя</legend><div className="mt-4 grid grid-cols-7 border-y border-white/[0.08]">{workDays.map(([value, label]) => <label key={value} className="cursor-pointer border-l border-white/[0.08] first:border-l-0"><input type="checkbox" name="workingDays" value={value} defaultChecked={master?.workingDays.includes(value) ?? value <= 5} className="peer sr-only" /><span className="flex h-16 flex-col items-center justify-center text-[10px] text-[#68716f] peer-checked:bg-[var(--accent)] peer-checked:font-semibold peer-checked:text-[#25272c]"><span>{label}</span><span className="mt-1 text-[8px] opacity-65">{value <= 5 ? "будни" : "выходной"}</span></span></label>)}</div>{state.fieldErrors.workingDays?.length ? <p className="mt-2 text-[10px] text-[#ef8a8f]">{state.fieldErrors.workingDays[0]}</p> : null}<p className="mt-4 text-[10px] leading-4 text-[#747d7b]">Отмеченные дни участвуют в подборе мастера и проверке доступности календаря.</p></fieldset>
    </div>
    <div className="grid gap-4 p-5 sm:grid-cols-2"><OrderField label="Статус действует до" errors={state.fieldErrors.statusUntil}><DateInput name="statusUntil" defaultValue={master?.statusUntil ?? ""} /></OrderField><OrderField label="Причина / комментарий" errors={state.fieldErrors.statusNote}><input name="statusNote" maxLength={1000} defaultValue={master?.statusNote ?? ""} placeholder="Отпуск до даты, больничный, причина увольнения" className={orderInputClass} /></OrderField></div>
    <p className="border-t border-white/[0.08] px-5 py-4 text-[10px] leading-4 text-[#747d7b]">«Уволен» скрывает мастера из новых назначений, но сохраняет выезды, заказы, начисления и историю.</p>
  </section>;
}

function MasterForm({ master, requestKey, onComplete }: { master?: MasterListItem; requestKey?: string; onComplete: () => void }) {
  const [state, formAction, pending] = useActionState(master ? updateMasterAction : createMasterAction, initialState);
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(() => {
      onComplete();
      router.refresh();
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [onComplete, router, state.status]);

  return <form action={formAction} className="flex min-h-full flex-1 flex-col">
    {requestKey ? <input type="hidden" name="idempotencyKey" value={requestKey} /> : null}
    {master ? <><input type="hidden" name="masterId" value={master.id} /><input type="hidden" name="expectedVersion" value={master.version} /></> : null}
    <div className="flex-1 space-y-6 p-5 sm:p-7">
      <MasterFields state={state} master={master} />
      <MasterAvailabilityFields state={state} master={master} />
      <MutationStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel={master ? "Сохранить" : "Добавить мастера"} />
  </form>;
}

export function CreateMasterButton() {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>
    <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[#25272c]"><Plus className="size-4" />Новый мастер</button>
    <Dialog open={requestKey !== null} onClose={close} title="Новый мастер" description="Контакты, зона и условия оплаты сохранятся в справочнике.">{requestKey ? <MasterForm requestKey={requestKey} onComplete={close} /> : null}</Dialog>
  </>;
}

export function EditMasterButton({ master, onOpen }: { master: MasterListItem; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" aria-label={`Редактировать мастера ${master.fullName}`} onClick={() => { setOpen(true); onOpen?.(); }} className="focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[12px] border border-white/[0.08] px-3 text-xs text-[#aeb6ba] hover:bg-white/[0.04] hover:text-white"><UserRoundPen className="size-4" />Редактировать</button>
    <Dialog open={open} onClose={close} title={master.fullName} description="Изменения справочника не переписывают исторические данные уже созданных заказов.">{open ? <MasterForm master={master} onComplete={close} /> : null}</Dialog>
  </>;
}
