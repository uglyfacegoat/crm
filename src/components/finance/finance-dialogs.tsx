"use client";

import { DateInput } from "@/components/ui/date-time-inputs";
import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { clientCrypto as crypto } from "@/lib/client-id";
import {
  createInvoiceAction,
  createPaymentAction,
  createPayoutAction,
  reversePaymentAction,
  reversePayoutAction,
  voidInvoiceAction,
  type FinanceActionState,
} from "@/app/(workspace)/finance/actions";
import { Dialog } from "@/components/ui/dialog";
import { formatMoneyMinor } from "@/lib/format";
import type { FinanceInvoice, FinanceOrder, FinancePayment, FinancePayout, PaymentMethod } from "@/server/finance/types";
import { OrderField, orderInputClass, orderTextareaClass } from "@/components/orders/order-form-parts";

export type FinanceDialog =
  | { kind: "invoice"; order: FinanceOrder }
  | { kind: "payment"; order: FinanceOrder; invoice: FinanceInvoice }
  | { kind: "payout"; order: FinanceOrder }
  | { kind: "reverse-payment"; payment: FinancePayment }
  | { kind: "reverse-payout"; payout: FinancePayout }
  | { kind: "void-invoice"; invoice: FinanceInvoice }
  | null;

const initialState: FinanceActionState = { status: "idle", message: null, fieldErrors: {} };
const paymentMethodLabels: Record<PaymentMethod, string> = { bank_transfer: "Банковский перевод", cash: "Наличные", card: "Карта", other: "Другое" };

function ActionStatus({ state }: { state: FinanceActionState }) {
  if (state.status === "idle") return null;
  return <div role="status" className={`rounded-[12px] border p-3 text-xs leading-5 ${state.status === "success" ? "border-[#b8f7e4]/20 bg-[#b8f7e4]/[0.05] text-[#83d4b2]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#df8c90]"}`}>{state.message}</div>;
}

function FormFooter({ pending, saved, onClose, submitLabel, danger = false }: { pending: boolean; saved: boolean; onClose: () => void; submitLabel: string; danger?: boolean }) {
  return <footer className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-white/[0.07] bg-[#25272c] p-4 sm:px-7"><button type="button" onClick={onClose} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#9aa3a8]">Отмена</button><button disabled={pending || saved} className={`focus-ring flex h-11 min-w-36 items-center justify-center gap-2 rounded-[12px] px-4 text-xs font-semibold disabled:opacity-60 ${danger ? "bg-[#d6545a] text-white" : "bg-[var(--accent)] text-[#25272c]"}`}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}{saved ? "Сохранено" : submitLabel}</button></footer>;
}

function PaymentMethodField({ errors }: { errors?: string[] }) {
  return <OrderField label="Способ" required errors={errors}><select name="paymentMethod" defaultValue="bank_transfer" className={orderInputClass}>{Object.entries(paymentMethodLabels).map(([value, label]) => <option key={value} value={value} className="bg-[#11181c]">{label}</option>)}</select></OrderField>;
}

function useCloseOnSuccess(state: FinanceActionState, onClose: () => void) {
  useEffect(() => {
    if (state.status !== "success") return;
    const timeout = window.setTimeout(onClose, 550);
    return () => window.clearTimeout(timeout);
  }, [onClose, state.status]);
}

function InvoiceForm({ order, today, onClose }: { order: FinanceOrder; today: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createInvoiceAction, initialState);
  const [requestKey] = useState(() => crypto.randomUUID());
  const remaining = Math.max(0, order.agreedMinor - order.invoicedMinor);
  useCloseOnSuccess(state, onClose);
  return <form action={action} className="flex min-h-0 flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="orderId" value={order.id} /><div className="flex-1 space-y-5 p-5 sm:p-7"><div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-xs font-medium text-white">{order.number} · {order.client}</p><p className="mt-1 text-[10px] text-[#6f797f]">{order.object}</p><div className="mt-4 flex items-center justify-between text-xs"><span className="text-[#79838a]">Можно выставить</span><strong className="font-display text-white">{formatMoneyMinor(remaining)}</strong></div></div><OrderField label="Номер счёта" required errors={state.fieldErrors.invoiceNumber}><input name="invoiceNumber" required maxLength={120} placeholder={`СЧ-${order.number.replace(/\D/g, "")}`} className={orderInputClass} /></OrderField><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Сумма, ₽" required errors={state.fieldErrors.amount}><input name="amount" required inputMode="decimal" defaultValue={remaining / 100} className={orderInputClass} /></OrderField><OrderField label="Дата счёта" required errors={state.fieldErrors.issuedOn}><DateInput name="issuedOn" required max={today} defaultValue={today} className={orderInputClass} /></OrderField></div><OrderField label="Оплатить до" required errors={state.fieldErrors.dueOn}><DateInput name="dueOn" required min={today} className={orderInputClass} /></OrderField><OrderField label="Комментарий" errors={state.fieldErrors.note}><textarea name="note" maxLength={2000} placeholder="Основание или условия оплаты" className={orderTextareaClass} /></OrderField><ActionStatus state={state} /></div><FormFooter pending={pending} saved={state.status === "success"} onClose={onClose} submitLabel="Выставить счёт" /></form>;
}

function PaymentForm({ order, invoice, today, onClose }: { order: FinanceOrder; invoice: FinanceInvoice; today: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createPaymentAction, initialState);
  const [requestKey] = useState(() => crypto.randomUUID());
  useCloseOnSuccess(state, onClose);
  return <form action={action} className="flex min-h-0 flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="invoiceId" value={invoice.id} /><div className="flex-1 space-y-5 p-5 sm:p-7"><div className="rounded-[14px] border border-[#b8f7e4]/15 bg-[#b8f7e4]/[0.035] p-4"><p className="text-xs font-medium text-white">Счёт {invoice.number} · {order.client}</p><div className="mt-4 flex items-center justify-between text-xs"><span className="text-[#7f8b87]">Остаток</span><strong className="font-display text-[#83d4b2]">{formatMoneyMinor(invoice.outstandingMinor)}</strong></div></div><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Сумма, ₽" required errors={state.fieldErrors.amount}><input name="amount" required inputMode="decimal" defaultValue={invoice.outstandingMinor / 100} className={orderInputClass} /></OrderField><OrderField label="Дата получения" required errors={state.fieldErrors.receivedOn}><DateInput name="receivedOn" required max={today} defaultValue={today} className={orderInputClass} /></OrderField></div><PaymentMethodField errors={state.fieldErrors.paymentMethod} /><OrderField label="Номер операции" errors={state.fieldErrors.reference}><input name="reference" maxLength={200} placeholder="Платёжное поручение, чек" className={orderInputClass} /></OrderField><OrderField label="Комментарий" errors={state.fieldErrors.note}><textarea name="note" maxLength={2000} className={orderTextareaClass} /></OrderField><ActionStatus state={state} /></div><FormFooter pending={pending} saved={state.status === "success"} onClose={onClose} submitLabel="Провести оплату" /></form>;
}

function PayoutForm({ order, today, onClose }: { order: FinanceOrder; today: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(createPayoutAction, initialState);
  const [requestKey] = useState(() => crypto.randomUUID());
  useCloseOnSuccess(state, onClose);
  return <form action={action} className="flex min-h-0 flex-1 flex-col"><input type="hidden" name="idempotencyKey" value={requestKey} /><input type="hidden" name="orderId" value={order.id} /><div className="flex-1 space-y-5 p-5 sm:p-7"><div className="rounded-[14px] border border-[#b8f7e4]/15 bg-[#b8f7e4]/[0.035] p-4"><p className="text-xs font-medium text-white">{order.masterName} · {order.number}</p><p className="mt-1 text-[10px] text-[#7b758c]">{order.client} · {order.object}</p><div className="mt-4 flex items-center justify-between text-xs"><span className="text-[#888093]">К выплате</span><strong className="font-display text-[#b8a5eb]">{formatMoneyMinor(order.masterDueMinor)}</strong></div></div><div className="grid gap-4 sm:grid-cols-2"><OrderField label="Сумма, ₽" required errors={state.fieldErrors.amount}><input name="amount" required inputMode="decimal" defaultValue={order.masterDueMinor / 100} className={orderInputClass} /></OrderField><OrderField label="Дата выплаты" required errors={state.fieldErrors.paidOn}><DateInput name="paidOn" required max={today} defaultValue={today} className={orderInputClass} /></OrderField></div><PaymentMethodField errors={state.fieldErrors.paymentMethod} /><OrderField label="Номер ведомости / операции" errors={state.fieldErrors.reference}><input name="reference" maxLength={200} className={orderInputClass} /></OrderField><OrderField label="Комментарий" errors={state.fieldErrors.note}><textarea name="note" maxLength={2000} className={orderTextareaClass} /></OrderField><ActionStatus state={state} /></div><FormFooter pending={pending} saved={state.status === "success"} onClose={onClose} submitLabel="Провести выплату" /></form>;
}

function DestructiveForm({ kind, entry, onClose }: { kind: "payment" | "payout" | "invoice"; entry: FinancePayment | FinancePayout | FinanceInvoice; onClose: () => void }) {
  const selectedAction = kind === "payment" ? reversePaymentAction : kind === "payout" ? reversePayoutAction : voidInvoiceAction;
  const [state, action, pending] = useActionState(selectedAction, initialState);
  useCloseOnSuccess(state, onClose);
  const amount = kind === "invoice" ? (entry as FinanceInvoice).amountMinor : (entry as FinancePayment | FinancePayout).amountMinor;
  return <form action={action} className="flex min-h-0 flex-1 flex-col"><input type="hidden" name={kind === "invoice" ? "invoiceId" : "entryId"} value={entry.id} /><input type="hidden" name="expectedVersion" value={entry.version} /><div className="flex-1 space-y-5 p-5 sm:p-7"><div className="rounded-[14px] border border-[#ef646a]/18 bg-[#ef646a]/[0.045] p-4"><div className="flex gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#df6f75]" /><div><p className="text-sm font-medium text-white">{kind === "invoice" ? "Счёт будет исключён из дебиторки" : "Сумма будет исключена из проведённых операций"}</p><p className="mt-2 text-xs leading-5 text-[#a47a7d]">{formatMoneyMinor(amount)} · исходная запись останется в истории и аудите.</p></div></div></div><OrderField label="Причина" required errors={state.fieldErrors.reason}><textarea name="reason" required minLength={3} maxLength={1000} placeholder="Почему операция отменяется" className={orderTextareaClass} /></OrderField><ActionStatus state={state} /></div><FormFooter pending={pending} saved={state.status === "success"} onClose={onClose} submitLabel={kind === "invoice" ? "Аннулировать счёт" : "Сторнировать"} danger /></form>;
}

export function FinanceDialogs({ dialog, today, onClose }: { dialog: FinanceDialog; today: string; onClose: () => void }) {
  const title = dialog?.kind === "invoice" ? "Новый счёт" : dialog?.kind === "payment" ? "Оплата клиента" : dialog?.kind === "payout" ? "Выплата мастеру" : dialog?.kind === "void-invoice" ? "Аннулировать счёт" : "Сторно операции";
  return <Dialog open={dialog !== null} onClose={onClose} title={title} description="Финансовые изменения сохраняются транзакционно и записываются в аудит.">{dialog?.kind === "invoice" ? <InvoiceForm order={dialog.order} today={today} onClose={onClose} /> : dialog?.kind === "payment" ? <PaymentForm order={dialog.order} invoice={dialog.invoice} today={today} onClose={onClose} /> : dialog?.kind === "payout" ? <PayoutForm order={dialog.order} today={today} onClose={onClose} /> : dialog?.kind === "reverse-payment" ? <DestructiveForm kind="payment" entry={dialog.payment} onClose={onClose} /> : dialog?.kind === "reverse-payout" ? <DestructiveForm kind="payout" entry={dialog.payout} onClose={onClose} /> : dialog?.kind === "void-invoice" ? <DestructiveForm kind="invoice" entry={dialog.invoice} onClose={onClose} /> : null}</Dialog>;
}
