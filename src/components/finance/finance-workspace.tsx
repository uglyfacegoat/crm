"use client";

import { ArrowDownToLine, Ban, Banknote, ChevronDown, CircleDollarSign, Clock3, FilePlus2, Landmark, ReceiptText, RotateCcw, Search, SlidersHorizontal, UserRoundCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { formatMoneyMinor } from "@/lib/format";
import type { FinanceInvoice, FinanceOrder, FinancePayment, FinancePayout, FinanceSnapshot, PaymentMethod } from "@/server/finance/types";
import { FinanceDialogs, type FinanceDialog } from "./finance-dialogs";

const methodLabels: Record<PaymentMethod, string> = { bank_transfer: "Перевод", cash: "Наличные", card: "Карта", other: "Другое" };
const statusLabels: Record<string, string> = { new: "Новый", approval: "Согласование", scheduled: "Запланирован", in_progress: "В работе", completed: "Выполнен", overdue: "Просрочен" };
type ReceivableState = "all" | "debt" | "overdue" | "paid" | "uninvoiced";
type LedgerFilter = "all" | "posted" | "reversed";
type FinanceSort = "debt-desc" | "debt-asc" | "amount-desc" | "number";
type FinanceFilters = { receivableState: ReceivableState; ledger: LedgerFilter; method: "all" | PaymentMethod; master: string; dateFrom: string; dateTo: string; amountMin: string; amountMax: string; sort: FinanceSort };
const defaultFilters: FinanceFilters = { receivableState: "all", ledger: "all", method: "all", master: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", sort: "debt-desc" };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00Z`));
}

function SummaryCell({ icon: Icon, label, value, note, tone }: { icon: typeof WalletCards; label: string; value: number; note: string; tone: string }) {
  return <article className="group min-h-32 min-w-0 bg-[var(--surface)] p-4 transition-colors hover:bg-[var(--surface-raised)] sm:p-5"><div className="flex items-center gap-2"><Icon className="size-4 shrink-0" style={{ color: tone }} /><p className="text-[10px] uppercase tracking-[0.11em] text-[#929b99]">{label}</p></div><strong className="mt-5 block truncate font-display text-[clamp(1.3rem,1.05rem+0.55vw,1.8rem)] font-semibold tracking-[-0.05em] text-white">{formatMoneyMinor(value)}</strong><p className="mt-2 truncate text-[9px] text-[#707976]">{note}</p></article>;
}

function parseRubles(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] text-white" : "border-white/[0.07] text-[#858f94] hover:bg-white/[0.035] hover:text-white"}`}>{label}</button>;
}

function LedgerStatus({ status, reversalReason }: { status: "posted" | "reversed"; reversalReason: string | null }) {
  return status === "posted" ? <span className="rounded-[7px] border border-[#b8f7e4]/20 bg-[#b8f7e4]/[0.055] px-2 py-1 text-[9px] text-[#78d4aa]">Проведено</span> : <span title={reversalReason ?? undefined} className="rounded-[7px] border border-[#ef646a]/20 bg-[#ef646a]/[0.055] px-2 py-1 text-[9px] text-[#dc7c81]">Сторно</span>;
}

function PaymentRow({ payment, canWrite, onReverse }: { payment: FinancePayment; canWrite: boolean; onReverse: () => void }) {
  return <div className="grid gap-2 border-t border-white/[0.05] py-3 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)_8rem_auto] sm:items-center sm:gap-3"><div><p className="font-display text-xs text-white">{formatMoneyMinor(payment.amountMinor)}</p><p className="mt-1 text-[9px] text-[#687279]">{formatDate(payment.receivedOn)}</p></div><div className="min-w-0"><p className="truncate text-[10px] text-[#a0a9ad]">{methodLabels[payment.method]}{payment.reference ? ` · ${payment.reference}` : ""}</p>{payment.note ? <p className="mt-1 truncate text-[9px] text-[#646e74]">{payment.note}</p> : null}</div><LedgerStatus status={payment.status} reversalReason={payment.reversalReason} />{canWrite && payment.status === "posted" ? <button type="button" onClick={onReverse} className="focus-ring flex h-9 items-center justify-center gap-1.5 rounded-[10px] border border-white/[0.07] px-3 text-[9px] text-[#a6787b] hover:bg-[#ef646a]/[0.05]"><Ban className="size-3.5" />Сторно</button> : <span />}</div>;
}

function InvoiceCard({ order, invoice, canWrite, onDialog }: { order: FinanceOrder; invoice: FinanceInvoice; canWrite: boolean; onDialog: (dialog: FinanceDialog) => void }) {
  const paymentProgress = invoice.amountMinor ? Math.min(100, Math.round(invoice.paidMinor / invoice.amountMinor * 100)) : 0;
  return (
    <article className={`rounded-[14px] border p-4 ${invoice.status === "void" ? "border-white/[0.05] bg-black/10 opacity-65" : invoice.overdue ? "border-[#ef646a]/20 bg-[#ef646a]/[0.025]" : "border-white/[0.07] bg-black/10"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-white">Счёт {invoice.number}</p>
            {invoice.status === "void" ? <span className="rounded-[7px] bg-white/[0.05] px-2 py-1 text-[9px] text-[#8b9499]">Аннулирован</span> : invoice.overdue ? <span className="rounded-[7px] bg-[#ef646a]/10 px-2 py-1 text-[9px] text-[#e0767b]">Просрочен</span> : invoice.outstandingMinor === 0 ? <span className="rounded-[7px] bg-[#b8f7e4]/[0.07] px-2 py-1 text-[9px] text-[#78d4aa]">Оплачен</span> : <span className="rounded-[7px] bg-[#efb454]/[0.07] px-2 py-1 text-[9px] text-[#d8ae69]">Ожидает оплату</span>}
          </div>
          <p className="mt-2 text-[10px] text-[#6b757b]">от {formatDate(invoice.issuedOn)} · срок {formatDate(invoice.dueOn)}</p>
          {invoice.note ? <p className="mt-2 text-[10px] text-[#858f94]">{invoice.note}</p> : null}
          {invoice.voidReason ? <p className="mt-2 text-[9px] text-[#a27477]">Причина: {invoice.voidReason}</p> : null}
        </div>
        <div className="flex shrink-0 items-end justify-between gap-4 sm:block sm:text-right">
          <span className="rounded-[8px] border border-[#b8f7e4]/15 bg-[#b8f7e4]/[0.055] px-2 py-1 font-display text-[10px] text-[#78d4aa]" aria-label={`Получено ${paymentProgress}%`}>{paymentProgress}% оплачено</span>
          <div className="mt-2"><strong className="font-display text-sm text-white">{formatMoneyMinor(invoice.amountMinor)}</strong><p className="mt-1 text-[9px] text-[#6b757b]">Остаток {formatMoneyMinor(invoice.outstandingMinor)}</p></div>
        </div>
      </div>
      {invoice.status === "issued" ? <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-[9px] text-[#687279]">Получено {formatMoneyMinor(invoice.paidMinor)}</span>{canWrite ? <div className="flex gap-2">{invoice.outstandingMinor > 0 ? <button type="button" onClick={() => onDialog({ kind: "payment", order, invoice })} className="focus-ring flex h-9 items-center gap-1.5 rounded-[10px] bg-[#b8f7e4]/[0.09] px-3 text-[9px] font-medium text-[#82d4b1]"><ArrowDownToLine className="size-3.5" />Добавить оплату</button> : null}{invoice.paidMinor === 0 ? <button type="button" onClick={() => onDialog({ kind: "void-invoice", invoice })} className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#9b7477]" aria-label={`Аннулировать счёт ${invoice.number}`}><Ban className="size-3.5" /></button> : null}</div> : null}</div> : null}
      {invoice.payments.length ? <details className="group mt-3"><summary className="focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-lg text-[9px] text-[#778188] [&::-webkit-details-marker]:hidden"><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />История оплат · {invoice.payments.length}</summary><div>{invoice.payments.map((payment) => <PaymentRow key={payment.id} payment={payment} canWrite={canWrite} onReverse={() => onDialog({ kind: "reverse-payment", payment })} />)}</div></details> : null}
    </article>
  );
}

function OrderLedgerCard({ order, canWrite, onDialog }: { order: FinanceOrder; canWrite: boolean; onDialog: (dialog: FinanceDialog) => void }) {
  const remainingToInvoice = Math.max(0, order.agreedMinor - order.invoicedMinor);
  const settled = order.receivableMinor === 0 && order.invoicedMinor > 0;
  return (
    <article className={`relative overflow-hidden border-b border-white/[0.07] p-4 last:border-b-0 sm:p-5 ${order.receivableMinor > 0 ? "bg-[#2a2927]" : "bg-[var(--surface)]"}`}>
      <span className={`absolute bottom-0 left-0 top-0 w-0.5 ${settled ? "bg-[#b8f7e4]/70" : order.receivableMinor > 0 ? "bg-[#efb454]/70" : "bg-[#b8f7e4]/45"}`} />
      <div className="grid gap-5 xl:grid-cols-[minmax(12rem,0.8fr)_minmax(30rem,1.5fr)_auto] xl:items-center">
        <div className="min-w-0 pl-1">
          <div className="flex flex-wrap items-center gap-2"><Link href={`/orders/${order.id}`} className="focus-ring rounded-md font-display text-sm font-semibold text-white hover:text-[var(--accent)]">{order.number}</Link><span className="rounded-[7px] bg-white/[0.045] px-2 py-1 text-[9px] text-[#7c868c]">{statusLabels[order.status] ?? order.status}</span></div>
          <p className="mt-3 truncate text-xs font-medium text-[#d2d7d5]">{order.client}</p>
          <p className="mt-1 truncate text-[10px] text-[#6d777d]">{order.object}</p>
        </div>
        <dl className="grid grid-cols-2 border-y border-white/[0.08] min-[520px]:grid-cols-4">
          <div className="p-3"><dt className="text-[9px] text-[#6f7876]">Согласовано</dt><dd className="mt-2 font-display text-xs text-white">{formatMoneyMinor(order.agreedMinor)}</dd></div>
          <div className="border-l border-white/[0.08] p-3"><dt className="text-[9px] text-[#6f7876]">Выставлено</dt><dd className="mt-2 font-display text-xs text-[var(--accent)]">{formatMoneyMinor(order.invoicedMinor)}</dd></div>
          <div className="border-l border-white/[0.08] p-3"><dt className="text-[9px] text-[#6f7876]">Получено</dt><dd className="mt-2 font-display text-xs text-[var(--accent)]">{formatMoneyMinor(order.paidMinor)}</dd></div>
          <div className="border-l border-white/[0.08] p-3"><dt className="text-[9px] text-[#6f7876]">Осталось</dt><dd className={`mt-2 font-display text-xs ${order.receivableMinor > 0 ? "text-[#e8b666]" : "text-[var(--accent)]"}`}>{formatMoneyMinor(order.receivableMinor)}</dd></div>
        </dl>
        <div className="flex items-center gap-2 xl:justify-end">{settled ? <span className="rounded-[9px] border border-[#b8f7e4]/15 bg-[#b8f7e4]/[0.055] px-3 py-2 text-[10px] text-[#78d4aa]">Расчёт закрыт</span> : null}{canWrite && remainingToInvoice > 0 ? <button type="button" onClick={() => onDialog({ kind: "invoice", order })} className="focus-ring flex h-10 shrink-0 items-center justify-center gap-2 rounded-[11px] bg-[var(--accent)] px-3 text-[10px] font-semibold text-[#25272c]"><FilePlus2 className="size-4" />Новый счёт</button> : null}</div>
      </div>
      <details className="group mt-4 border-t border-white/[0.055] pt-3"><summary className="focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[9px] text-[10px] text-[#7f898e] [&::-webkit-details-marker]:hidden"><ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />Счета и оплаты <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[8px]">{order.invoices.length}</span></summary><div className="mt-3 grid gap-3 xl:grid-cols-2">{order.invoices.length ? order.invoices.map((invoice) => <InvoiceCard key={invoice.id} order={order} invoice={invoice} canWrite={canWrite} onDialog={onDialog} />) : <p className="rounded-[14px] border border-dashed border-white/[0.07] py-8 text-center text-xs text-[#626c72]">По заказу ещё нет счетов.</p>}</div></details>
    </article>
  );
}

function PayoutRow({ payout, canWrite, onReverse }: { payout: FinancePayout; canWrite: boolean; onReverse: () => void }) {
  return <article className="border-b border-white/[0.055] p-4 last:border-0 sm:grid sm:grid-cols-[minmax(10rem,1.3fr)_8rem_minmax(9rem,1fr)_8rem_auto] sm:items-center sm:gap-4 sm:px-5"><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{payout.masterName}</p><Link href={`/orders/${payout.orderId}`} className="mt-1 block text-[10px] text-[#79838a] hover:text-[var(--accent)]">Заказ {payout.orderNumber}</Link></div><p className="mt-3 text-[10px] text-[#7c868b] sm:mt-0">{formatDate(payout.paidOn)}</p><p className="mt-2 truncate text-[10px] text-[#929b9f] sm:mt-0">{methodLabels[payout.method]}{payout.reference ? ` · ${payout.reference}` : ""}</p><div className="mt-3 sm:mt-0"><LedgerStatus status={payout.status} reversalReason={payout.reversalReason} /></div><div className="mt-3 flex items-center justify-between gap-3 sm:mt-0 sm:justify-end"><strong className="font-display text-xs text-white">{formatMoneyMinor(payout.amountMinor)}</strong>{canWrite && payout.status === "posted" ? <button type="button" onClick={onReverse} aria-label={`Сторнировать выплату ${payout.masterName}`} className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#9b7477]"><Ban className="size-3.5" /></button> : null}</div></article>;
}

export function FinanceWorkspace({ snapshot, canWrite }: { snapshot: FinanceSnapshot; canWrite: boolean }) {
  const [tab, setTab] = useState<"receivables" | "payouts">("receivables");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FinanceDialog>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  const payoutMasters = useMemo(() => Array.from(new Set(snapshot.payouts.map((payout) => payout.masterName))).sort((a, b) => a.localeCompare(b, "ru")), [snapshot.payouts]);
  const visibleOrders = useMemo(() => {
    const amountMin = parseRubles(filters.amountMin);
    const amountMax = parseRubles(filters.amountMax);
    const visible = snapshot.orders.filter((order) => {
      const hasOverdue = order.invoices.some((invoice) => invoice.status === "issued" && invoice.overdue && invoice.outstandingMinor > 0);
      if (filters.receivableState === "debt" && order.receivableMinor <= 0) return false;
      if (filters.receivableState === "overdue" && !hasOverdue) return false;
      if (filters.receivableState === "paid" && !(order.invoicedMinor > 0 && order.receivableMinor === 0)) return false;
      if (filters.receivableState === "uninvoiced" && order.invoicedMinor >= order.agreedMinor) return false;
      if (amountMin !== null && order.receivableMinor < amountMin) return false;
      if (amountMax !== null && order.receivableMinor > amountMax) return false;
      return !normalizedQuery || `${order.number} ${order.client} ${order.object} ${order.invoices.map((invoice) => invoice.number).join(" ")}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery);
    });
    return visible.toSorted((left, right) => {
      if (filters.sort === "debt-asc") return left.receivableMinor - right.receivableMinor;
      if (filters.sort === "amount-desc") return right.agreedMinor - left.agreedMinor;
      if (filters.sort === "number") return left.number.localeCompare(right.number, "ru", { numeric: true });
      return right.receivableMinor - left.receivableMinor;
    });
  }, [filters, normalizedQuery, snapshot.orders]);
  const visiblePayouts = useMemo(() => {
    const dateFrom = parseDateInput(filters.dateFrom);
    const dateTo = parseDateInput(filters.dateTo);
    return snapshot.payouts.filter((payout) => {
      if (filters.ledger !== "all" && payout.status !== filters.ledger) return false;
      if (filters.method !== "all" && payout.method !== filters.method) return false;
      if (filters.master && payout.masterName !== filters.master) return false;
      if (dateFrom && payout.paidOn < dateFrom) return false;
      if (dateTo && payout.paidOn > dateTo) return false;
      return !normalizedQuery || `${payout.masterName} ${payout.orderNumber} ${payout.reference ?? ""}`.toLocaleLowerCase("ru-RU").includes(normalizedQuery);
    });
  }, [filters, normalizedQuery, snapshot.payouts]);
  const payoutOrders = snapshot.orders.filter((order) => order.masterDueMinor > 0 && order.masterId);
  const activeFilterCount = tab === "receivables"
    ? [filters.receivableState !== "all", Boolean(filters.amountMin), Boolean(filters.amountMax), filters.sort !== "debt-desc"].filter(Boolean).length
    : [filters.ledger !== "all", filters.method !== "all", Boolean(filters.master), Boolean(filters.dateFrom), Boolean(filters.dateTo)].filter(Boolean).length;

  function resetFilters() { setQuery(""); setFilters(defaultFilters); setDraftFilters(defaultFilters); setFilterError(null); }
  function applyFilters() {
    if (tab === "receivables") {
      if ((draftFilters.amountMin && parseRubles(draftFilters.amountMin) === null) || (draftFilters.amountMax && parseRubles(draftFilters.amountMax) === null)) { setFilterError("Сумма должна быть положительным числом."); return; }
      const min = parseRubles(draftFilters.amountMin);
      const max = parseRubles(draftFilters.amountMax);
      if (min !== null && max !== null && min > max) { setFilterError("Минимальная задолженность не может превышать максимальную."); return; }
    } else {
      const from = draftFilters.dateFrom ? parseDateInput(draftFilters.dateFrom) : null;
      const to = draftFilters.dateTo ? parseDateInput(draftFilters.dateTo) : null;
      if ((draftFilters.dateFrom && !from) || (draftFilters.dateTo && !to)) { setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ."); return; }
      if (from && to && from > to) { setFilterError("Начальная дата не может быть позже конечной."); return; }
    }
    setFilters(draftFilters); setFiltersOpen(false);
  }

  return <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] space-y-4"><section aria-label="Финансовые итоги" className="grid gap-px overflow-hidden border border-white/[0.09] bg-white/[0.09] min-[640px]:grid-cols-2 xl:grid-cols-4"><SummaryCell icon={Landmark} label="Выставлено" value={snapshot.summary.invoicedMinor} note={`из ${formatMoneyMinor(snapshot.summary.agreedMinor)} согласовано`} tone="#B8F7E4" /><SummaryCell icon={ArrowDownToLine} label="Получено" value={snapshot.summary.receivedMinor} note="Проведённые оплаты клиентов" tone="#B8F7E4" /><SummaryCell icon={Clock3} label="Дебиторка" value={snapshot.summary.receivableMinor} note={`просрочено ${formatMoneyMinor(snapshot.summary.overdueMinor)}`} tone="#efb454" /><SummaryCell icon={UserRoundCheck} label="К выплате мастерам" value={snapshot.summary.masterDueMinor} note={`выплачено ${formatMoneyMinor(snapshot.summary.masterPaidMinor)}`} tone="#B8F7E4" /></section>

    <section className="surface-panel overflow-hidden"><header className="flex flex-col gap-3 border-b border-white/[0.07] p-3 sm:p-4 lg:flex-row lg:items-center"><div className="flex gap-1 rounded-[12px] border border-white/[0.07] bg-black/10 p-1"><button type="button" onClick={() => { setTab("receivables"); resetFilters(); }} className={`focus-ring h-10 rounded-[9px] px-3 text-[10px] font-medium ${tab === "receivables" ? "bg-white/[0.08] text-white" : "text-[#727c82]"}`}><span className="flex items-center gap-2"><ReceiptText className="size-3.5" />Дебиторка</span></button><button type="button" onClick={() => { setTab("payouts"); resetFilters(); }} className={`focus-ring h-10 rounded-[9px] px-3 text-[10px] font-medium ${tab === "payouts" ? "bg-white/[0.08] text-white" : "text-[#727c82]"}`}><span className="flex items-center gap-2"><Banknote className="size-3.5" />Мастера</span></button></div><label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-white/[0.08] bg-black/10 px-3 lg:max-w-md"><Search className="size-4 shrink-0 text-[#657078]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "receivables" ? "Заказ, клиент, объект или счёт" : "Мастер, заказ или операция"} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#59636a]" /></label><button type="button" onClick={() => { setDraftFilters(filters); setFilterError(null); setFiltersOpen(true); }} className={`focus-ring flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border px-3 text-xs ${activeFilterCount ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] text-white" : "border-white/[0.07] text-[#858f94]"}`}><SlidersHorizontal className="size-4" />Фильтры{activeFilterCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[#25272c]">{activeFilterCount}</span> : null}</button>{query.trim() || activeFilterCount ? <button type="button" onClick={resetFilters} className="focus-ring flex h-11 shrink-0 items-center justify-center gap-2 rounded-[12px] border border-white/[0.07] px-3 text-xs text-[#7c858b]"><RotateCcw className="size-3.5" />Сбросить</button> : null}<div className="ml-auto hidden items-center gap-2 text-[9px] text-[#657078] 2xl:flex"><CircleDollarSign className="size-4" />Все суммы в рублях · история не удаляется</div></header>

      {tab === "receivables" ? <div className="grid gap-3 p-3 sm:p-4">{visibleOrders.length ? visibleOrders.map((order) => <OrderLedgerCard key={order.id} order={order} canWrite={canWrite} onDialog={setDialog} />) : <div className="grid min-h-56 place-items-center p-6 text-center"><div><ReceiptText className="mx-auto size-8 text-[#485259]" /><p className="mt-4 text-sm text-[#8a9499]">Ничего не найдено</p><p className="mt-2 text-xs text-[#5f696f]">Измените условия или сбросьте фильтры.</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-white/[0.07] px-3 py-2 text-xs text-white">Сбросить фильтры</button></div></div>}</div> : <div><section className="border-b border-white/[0.06] p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">Начисления к выплате</h2><p className="mt-1 text-[10px] text-[#657078]">Остаток считается по каждому заказу и закреплённому мастеру.</p></div><span className="rounded-full bg-[#b8f7e4]/[0.08] px-2.5 py-1 text-[9px] text-[#b8f7e4]">{payoutOrders.length}</span></div>{payoutOrders.length ? <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{payoutOrders.map((order) => <article key={order.id} className="rounded-[13px] border border-white/[0.07] bg-black/10 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-medium text-white">{order.masterName}</p><p className="mt-1 truncate text-[9px] text-[#6e777d]">{order.number} · {order.client}</p></div><strong className="shrink-0 font-display text-xs text-[#b8f7e4]">{formatMoneyMinor(order.masterDueMinor)}</strong></div>{canWrite ? <button type="button" onClick={() => setDialog({ kind: "payout", order })} className="focus-ring mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-[10px] bg-[#b8f7e4]/[0.1] text-[9px] font-medium text-[#b8f7e4]"><WalletCards className="size-3.5" />Провести выплату</button> : null}</article>)}</div> : <p className="mt-4 rounded-[12px] border border-dashed border-white/[0.07] py-7 text-center text-xs text-[#626c72]">Задолженности перед мастерами нет.</p>}</section><section><div className="border-b border-white/[0.06] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold text-white">История выплат</h2></div>{visiblePayouts.length ? visiblePayouts.map((payout) => <PayoutRow key={payout.id} payout={payout} canWrite={canWrite} onReverse={() => setDialog({ kind: "reverse-payout", payout })} />) : <p className="py-14 text-center text-xs text-[#626c72]">Выплат по выбранным условиям нет.</p>}</section></div>}
      <footer className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3 text-[10px] text-[#667077]"><span>Показано {tab === "receivables" ? visibleOrders.length : visiblePayouts.length}</span><span>{activeFilterCount ? `${activeFilterCount} активных условий` : "Без ограничений"}</span></footer>
    </section>

    <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title={tab === "receivables" ? "Фильтры дебиторки" : "Фильтры выплат"} description={tab === "receivables" ? "Отберите заказы по состоянию расчётов, размеру долга и порядку отображения." : "Найдите выплаты по мастеру, способу, состоянию проводки и дате."}>
      <div className="space-y-7 p-5 sm:p-7">{tab === "receivables" ? <>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Состояние расчётов</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.receivableState} label="Все заказы" onChange={(receivableState) => setDraftFilters((current) => ({ ...current, receivableState }))} /><FilterChoice value="debt" current={draftFilters.receivableState} label="Есть задолженность" onChange={(receivableState) => setDraftFilters((current) => ({ ...current, receivableState }))} /><FilterChoice value="overdue" current={draftFilters.receivableState} label="Просроченные счета" onChange={(receivableState) => setDraftFilters((current) => ({ ...current, receivableState }))} /><FilterChoice value="paid" current={draftFilters.receivableState} label="Оплачено полностью" onChange={(receivableState) => setDraftFilters((current) => ({ ...current, receivableState }))} /><FilterChoice value="uninvoiced" current={draftFilters.receivableState} label="Не всё выставлено" onChange={(receivableState) => setDraftFilters((current) => ({ ...current, receivableState }))} /></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Размер задолженности</legend><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-[10px] text-[#747e84]">От, ₽</span><input inputMode="decimal" value={draftFilters.amountMin} onChange={(event) => setDraftFilters((current) => ({ ...current, amountMin: event.target.value }))} placeholder="0" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label><label><span className="mb-2 block text-[10px] text-[#747e84]">До, ₽</span><input inputMode="decimal" value={draftFilters.amountMax} onChange={(event) => setDraftFilters((current) => ({ ...current, amountMax: event.target.value }))} placeholder="Без ограничения" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="debt-desc" current={draftFilters.sort} label="Сначала большой долг" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="debt-asc" current={draftFilters.sort} label="Сначала без долга" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="amount-desc" current={draftFilters.sort} label="Сначала крупные заказы" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /><FilterChoice value="number" current={draftFilters.sort} label="По номеру заказа" onChange={(sort) => setDraftFilters((current) => ({ ...current, sort }))} /></div></fieldset>
      </> : <>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Проводка</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><FilterChoice value="all" current={draftFilters.ledger} label="Все" onChange={(ledger) => setDraftFilters((current) => ({ ...current, ledger }))} /><FilterChoice value="posted" current={draftFilters.ledger} label="Проведённые" onChange={(ledger) => setDraftFilters((current) => ({ ...current, ledger }))} /><FilterChoice value="reversed" current={draftFilters.ledger} label="Сторно" onChange={(ledger) => setDraftFilters((current) => ({ ...current, ledger }))} /></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Способ выплаты</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.method} label="Любой способ" onChange={(method) => setDraftFilters((current) => ({ ...current, method }))} />{Object.entries(methodLabels).map(([method, label]) => <FilterChoice key={method} value={method as PaymentMethod} current={draftFilters.method} label={label} onChange={(selectedMethod) => setDraftFilters((current) => ({ ...current, method: selectedMethod }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Мастер</legend><div className="max-h-48 space-y-1 overflow-y-auto rounded-[13px] border border-white/[0.07] bg-black/10 p-1.5" role="radiogroup"><FilterChoice value="" current={draftFilters.master} label="Любой мастер" onChange={(master) => setDraftFilters((current) => ({ ...current, master }))} />{payoutMasters.map((master) => <FilterChoice key={master} value={master} current={draftFilters.master} label={master} onChange={(selectedMaster) => setDraftFilters((current) => ({ ...current, master: selectedMaster }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Дата выплаты</legend><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-[10px] text-[#747e84]">С даты</span><input inputMode="numeric" value={draftFilters.dateFrom} onChange={(event) => setDraftFilters((current) => ({ ...current, dateFrom: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label><label><span className="mb-2 block text-[10px] text-[#747e84]">По дату</span><input inputMode="numeric" value={draftFilters.dateTo} onChange={(event) => setDraftFilters((current) => ({ ...current, dateTo: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label></div></fieldset>
      </>}{filterError ? <p role="alert" className="rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.055] p-3 text-xs text-[#dc898e]">{filterError}</p> : null}</div>
      <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-white/[0.07] bg-[#25272c]/95 p-4 backdrop-blur-xl sm:p-5"><button type="button" onClick={() => { setDraftFilters(defaultFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#899399]"><RotateCcw className="mr-2 inline size-3.5" />Очистить</button><button type="button" onClick={applyFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#25272c]">{tab === "receivables" ? "Показать заказы" : "Показать выплаты"}</button></footer>
    </Dialog>
    <FinanceDialogs dialog={dialog} today={snapshot.today} onClose={() => setDialog(null)} />
  </div>;
}
