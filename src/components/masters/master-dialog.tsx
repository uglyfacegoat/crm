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
import type { MasterListItem } from "@/server/masters/types";

const initialState: MasterMutationState = { status: "idle", message: null, fieldErrors: {} };

function MutationStatus({ state }: { state: MasterMutationState }) {
  if (!state.message) return null;
  return <p role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#69d3a4]/20 bg-[#69d3a4]/[0.05] text-[#8ed7b8]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#d89599]"}`}>{state.status === "success" ? <Check className="mr-2 inline size-4" /> : null}{state.message}</p>;
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
      {master ? <label className="flex cursor-pointer items-start gap-3 rounded-[13px] border border-white/[0.07] bg-black/10 p-4">
        <input name="active" type="checkbox" defaultChecked={master.active} className="mt-0.5 size-4 accent-[var(--accent)]" />
        <span><strong className="block text-xs font-medium text-white">Активен и доступен для назначения</strong><span className="mt-1 block text-[10px] leading-4 text-[#727c82]">Перед деактивацией переназначьте его будущие выезды.</span></span>
      </label> : null}
      <MutationStatus state={state} />
    </div>
    <OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onComplete} submitLabel={master ? "Сохранить" : "Добавить мастера"} />
  </form>;
}

export function CreateMasterButton() {
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => setRequestKey(null), []);
  return <>
    <button type="button" onClick={() => setRequestKey(crypto.randomUUID())} className="focus-ring flex h-11 items-center gap-2 rounded-[13px] bg-[var(--accent)] px-4 text-sm font-semibold text-[#101308]"><Plus className="size-4" />Новый мастер</button>
    <Dialog open={requestKey !== null} onClose={close} title="Новый мастер" description="Контакты, зона и условия оплаты сохранятся в справочнике.">{requestKey ? <MasterForm requestKey={requestKey} onComplete={close} /> : null}</Dialog>
  </>;
}

export function EditMasterButton({ master, onOpen }: { master: MasterListItem; onOpen?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    <button type="button" aria-label={`Изменить ${master.fullName}`} onClick={() => { setOpen(true); onOpen?.(); }} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[11px] border border-white/[0.07] text-[#737d83] hover:bg-white/[0.04] hover:text-white"><UserRoundPen className="size-4" /></button>
    <Dialog open={open} onClose={close} title={master.fullName} description="Изменения справочника не переписывают исторические данные уже созданных заказов.">{open ? <MasterForm master={master} onComplete={close} /> : null}</Dialog>
  </>;
}
