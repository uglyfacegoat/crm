"use client";

import { Pencil, Plus } from "lucide-react";
import { useActionState, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addOrderExpenseAction,
  updateOrderAction,
  type OrderMutationState,
} from "@/app/(workspace)/orders/actions";
import { Dialog } from "@/components/ui/dialog";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { orderStatusLabels, orderStatuses, type OrderCreationOptions, type OrderDetail, type OrderStatus } from "@/server/orders/types";
import { OrderField, OrderFormFooter, OrderFormStatus, orderInputClass, OrderPicker, orderTextareaClass } from "./order-form-parts";

const initialOrderMutationState: OrderMutationState = { status: "idle", message: null, fieldErrors: {} };

function useRefreshAfterSuccess(status: OrderMutationState["status"], onClose: () => void) {
  const router = useRouter();
  useEffect(() => {
    if (status !== "success") return;
    router.refresh();
    const timeout = window.setTimeout(onClose, 550);
    return () => window.clearTimeout(timeout);
  }, [onClose, router, status]);
}

function EditOrderForm({ order, options, onClose }: { order: OrderDetail; options: OrderCreationOptions; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateOrderAction, initialOrderMutationState);
  const [status, setStatus] = useState<OrderStatus>(order.statusCode);
  const [masterId, setMasterId] = useState(order.assignedMasterId ?? "");
  useRefreshAfterSuccess(state.status, onClose);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="expectedVersion" value={order.version} /><input type="hidden" name="status" value={status} /><input type="hidden" name="assignedMasterId" value={masterId} /><div className="flex-1 space-y-7 p-5 sm:p-7"><fieldset><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667077]">Статус</legend><div className="mt-3 grid grid-cols-2 gap-2">{orderStatuses.map((value) => <button key={value} type="button" onClick={() => setStatus(value)} className={`focus-ring min-h-11 rounded-[11px] border px-2 text-[10px] ${status === value ? "border-[var(--accent)]/35 bg-[var(--accent)]/[0.07] text-white" : "border-white/[0.07] text-[#768087] hover:bg-white/[0.035]"}`}>{orderStatusLabels[value]}</button>)}</div></fieldset>{status === "cancelled" ? <OrderField label="Причина отмены" required errors={state.fieldErrors.statusReason}><textarea name="statusReason" required minLength={3} maxLength={1000} defaultValue={order.statusReason ?? ""} placeholder="Почему заказ отменён" className={orderTextareaClass} /></OrderField> : <input type="hidden" name="statusReason" value="" />}<fieldset className="space-y-4"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#667077]">Исполнитель и экономика</legend><OrderPicker label="Мастер" value={masterId} onChange={setMasterId} options={[{ value: "", label: "Не назначен" }, ...options.masters.map((master) => ({ value: master.id, label: master.name, detail: master.phone }))]} placeholder="Не назначен" errors={state.fieldErrors.assignedMasterId} /><OrderField label="Выплата мастеру, ₽" required={Boolean(masterId)} errors={state.fieldErrors.masterPayment}><input name="masterPayment" disabled={!masterId} required={Boolean(masterId)} defaultValue={order.masterPaymentMinor === null ? "" : String(order.masterPaymentMinor / 100)} inputMode="decimal" className={orderInputClass} /></OrderField></fieldset><OrderField label="Внутренняя заметка" errors={state.fieldErrors.notes}><textarea name="notes" maxLength={4000} defaultValue={order.notes ?? ""} placeholder="Условия заказа и важные детали" className={orderTextareaClass} /></OrderField><OrderFormStatus state={state} /></div><OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Сохранить изменения" /></form>;
}

function AddExpenseForm({ orderId, requestKey, onClose }: { orderId: string; requestKey: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(addOrderExpenseAction, initialOrderMutationState);
  useRefreshAfterSuccess(state.status, onClose);
  return <form action={action} className="flex flex-1 flex-col"><input type="hidden" name="orderId" value={orderId} /><input type="hidden" name="idempotencyKey" value={requestKey} /><div className="flex-1 space-y-5 p-5 sm:p-7"><OrderField label="Категория" required errors={state.fieldErrors.category}><input name="category" required minLength={2} maxLength={80} placeholder="Топливо, материалы, парковка" className={orderInputClass} /></OrderField><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Сумма, ₽" required errors={state.fieldErrors.amount}><input name="amount" required inputMode="decimal" placeholder="1 500" className={orderInputClass} /></OrderField><OrderField label="Дата расхода" required errors={state.fieldErrors.occurredOn}><input name="occurredOn" required type="date" className={orderInputClass} /></OrderField></div><OrderField label="Комментарий" errors={state.fieldErrors.note}><textarea name="note" maxLength={1000} placeholder="Что именно оплачено" className={orderTextareaClass} /></OrderField><p className="text-[10px] leading-4 text-[#667078]">Расход сразу попадёт в экономику заказа и будет зафиксирован в журнале аудита.</p><OrderFormStatus state={state} /></div><OrderFormFooter pending={pending} saved={state.status === "success"} onCancel={onClose} submitLabel="Добавить расход" /></form>;
}

type ActiveDialog = "edit" | "expense" | null;

export function OrderActions({ order, options, canWrite, dispatchVisitId }: { order: OrderDetail; options: OrderCreationOptions; canWrite: boolean; dispatchVisitId: string | null }) {
  const [active, setActive] = useState<ActiveDialog>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const close = useCallback(() => { setActive(null); setRequestKey(null); }, []);

  return <><div className="flex w-full flex-wrap items-center gap-2 sm:w-auto"><VisitDispatchCardButton visitId={dispatchVisitId} className="flex-1 min-[520px]:flex-none" />{canWrite ? <><button onClick={() => setActive("edit")} className="focus-ring flex h-10 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[13px] bg-[#7363a8] px-3 text-xs font-semibold text-white min-[520px]:flex-none min-[520px]:px-4"><Pencil className="size-4" />Редактировать</button><button onClick={() => { setRequestKey(crypto.randomUUID()); setActive("expense"); }} className="focus-ring flex h-10 items-center gap-2 rounded-[13px] border border-white/[0.08] px-3 text-xs text-[#aab3b8] hover:bg-white/[0.04]"><Plus className="size-4" />Расход</button></> : null}</div><Dialog open={active === "edit"} onClose={close} title="Редактировать заказ" description="Изменения сохраняются с проверкой версии карточки.">{active === "edit" ? <EditOrderForm order={order} options={options} onClose={close} /> : null}</Dialog><Dialog open={active === "expense"} onClose={close} title="Новый расход" description="Топливо, материалы и другие прямые затраты по заказу.">{active === "expense" && requestKey ? <AddExpenseForm orderId={order.id} requestKey={requestKey} onClose={close} /> : null}</Dialog></>;
}
