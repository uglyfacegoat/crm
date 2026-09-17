"use client";

import {
  ArrowDownToLine,
  Ban,
  ChevronDown,
  FilePlus2,
  ReceiptText,
  RotateCcw,
  Search,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { formatMoneyMinor } from "@/lib/format";
import { matchesSearchText } from "@/lib/search-normalization";
import type {
  FinanceInvoice,
  FinanceOrder,
  FinancePayment,
  FinancePayout,
  FinanceSnapshot,
  PaymentMethod,
} from "@/server/finance/types";
import { FinanceDialogs, type FinanceDialog } from "./finance-dialogs";

const methodLabels: Record<PaymentMethod, string> = {
  bank_transfer: "Перевод",
  cash: "Наличные",
  card: "Карта",
  other: "Другое",
};
const statusLabels: Record<string, string> = {
  new: "Новый",
  approval: "Согласование",
  scheduled: "Запланирован",
  in_progress: "В работе",
  completed: "Выполнен",
  overdue: "Просрочен",
};
type ReceivableState = "all" | "debt" | "overdue" | "paid" | "uninvoiced";
type LedgerFilter = "all" | "posted" | "reversed";
type FinanceSort = "debt-desc" | "debt-asc" | "amount-desc" | "number";
type FinanceTab = "receivables" | "payouts" | "closed";
type FinanceFilters = {
  receivableState: ReceivableState;
  ledger: LedgerFilter;
  method: "all" | PaymentMethod;
  master: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
  sort: FinanceSort;
};
const defaultFilters: FinanceFilters = {
  receivableState: "all",
  ledger: "all",
  method: "all",
  master: "",
  dateFrom: "",
  dateTo: "",
  amountMin: "",
  amountMax: "",
  sort: "debt-desc",
};
const filterInputClass =
  "focus-ring h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

function parseRubles(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
}

function FilterChoice<T extends string>({
  value,
  current,
  label,
  onChange,
}: {
  value: T;
  current: T;
  label: string;
  onChange: (value: T) => void;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onChange(value)}
      className={`focus-ring min-h-10 rounded-[14px] border px-3.5 text-left text-xs transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );
}

function LedgerStatus({
  status,
  reversalReason,
}: {
  status: "posted" | "reversed";
  reversalReason: string | null;
}) {
  return status === "posted" ? (
    <span className="inline-flex rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-2.5 py-1 text-[9px] text-[var(--success)]">
      Проведено
    </span>
  ) : (
    <span
      title={reversalReason ?? undefined}
      className="inline-flex rounded-full border border-[var(--danger-border)] bg-[var(--danger-bg)] px-2.5 py-1 text-[9px] text-[var(--danger-ink)]"
    >
      Сторно
    </span>
  );
}

function PaymentRow({
  payment,
  canWrite,
  onReverse,
}: {
  payment: FinancePayment;
  canWrite: boolean;
  onReverse: () => void;
}) {
  return (
    <div className="grid gap-2 border-t border-[var(--line)] py-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
      <div>
        <p className="font-display text-xs text-[var(--text)]">
          {formatMoneyMinor(payment.amountMinor)}
        </p>
        <p className="mt-1 text-[9px] text-[var(--muted)]">
          {formatDate(payment.receivedOn)}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[10px] text-[var(--text-secondary)]">
          {methodLabels[payment.method]}
          {payment.reference ? ` · ${payment.reference}` : ""}
        </p>
        {payment.note ? (
          <p className="mt-1 truncate text-[9px] text-[var(--muted)]">
            {payment.note}
          </p>
        ) : null}
        {payment.receiptDocumentId ? (
          <a href={`/api/v1/documents/${payment.receiptDocumentId}/download`} onClick={(event) => event.stopPropagation()} className="focus-ring mt-1 inline-flex items-center gap-1 text-[9px] text-[var(--accent-ink)] hover:text-[var(--accent)]"><ArrowDownToLine className="size-3" />Открыть чек</a>
        ) : null}
      </div>
      <LedgerStatus
        status={payment.status}
        reversalReason={payment.reversalReason}
      />
      {canWrite && payment.status === "posted" ? (
        <button
          type="button"
          onClick={onReverse}
          className="focus-ring flex h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--danger-border)] bg-[var(--surface)] px-3 text-[9px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"
        >
          <Ban className="size-3.5" />
          Сторно
        </button>
      ) : null}
    </div>
  );
}

function InvoiceCard({
  order,
  invoice,
  canWrite,
  onDialog,
}: {
  order: FinanceOrder;
  invoice: FinanceInvoice;
  canWrite: boolean;
  onDialog: (dialog: FinanceDialog) => void;
}) {
  const paymentProgress = invoice.amountMinor
    ? Math.min(100, Math.round((invoice.paidMinor / invoice.amountMinor) * 100))
    : 0;
  return (
    <article
      className={`border-t border-[var(--line)] py-4 first:border-t-0 ${invoice.status === "void" ? "opacity-60" : ""}`}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-[var(--text)]">
              Счёт {invoice.number}
            </p>
            {invoice.status === "void" ? (
              <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">
                Аннулирован
              </span>
            ) : invoice.overdue ? (
              <span className="rounded-full bg-[var(--danger-bg)] px-2.5 py-1 text-[9px] text-[var(--danger-ink)]">
                Просрочен
              </span>
            ) : invoice.outstandingMinor === 0 ? (
              <span className="rounded-full bg-[var(--success-bg)] px-2.5 py-1 text-[9px] text-[var(--success)]">
                Оплачен
              </span>
            ) : (
              <span className="rounded-full bg-[var(--warning-bg)] px-2.5 py-1 text-[9px] text-[var(--warning)]">
                Ожидает оплату
              </span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-[var(--muted)]">
            от {formatDate(invoice.issuedOn)} · срок {formatDate(invoice.dueOn)}
          </p>
          {invoice.note ? (
            <p className="mt-2 text-[10px] text-[var(--text-secondary)]">
              {invoice.note}
            </p>
          ) : null}
          {invoice.voidReason ? (
            <p className="mt-2 text-[9px] text-[var(--danger-ink)]">
              Причина: {invoice.voidReason}
            </p>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-4 sm:block sm:text-right">
          <span
            className="text-[10px] text-[var(--success)]"
            aria-label={`Получено ${paymentProgress}%`}
          >
            {paymentProgress}% оплачено
          </span>
          <div className="mt-2">
            <strong className="font-display text-sm text-[var(--text)]">
              {formatMoneyMinor(invoice.amountMinor)}
            </strong>
            <p className="mt-1 text-[10px] text-[var(--muted)]">
              Остаток {formatMoneyMinor(invoice.outstandingMinor)}
            </p>
          </div>
        </div>
      </div>
      {invoice.status === "issued" ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
          <span className="text-[10px] text-[var(--muted)]">
            Получено {formatMoneyMinor(invoice.paidMinor)}
          </span>
          {canWrite ? (
            <div className="flex flex-wrap gap-2">
              {invoice.outstandingMinor > 0 ? (
                <button
                  type="button"
                  onClick={() => onDialog({ kind: "payment", order, invoice })}
                  className="focus-ring flex h-9 items-center gap-1.5 rounded-full bg-[var(--support-soft)] px-3.5 text-[10px] font-medium text-[var(--support-strong)] active:translate-y-px"
                >
                  <ArrowDownToLine className="size-3.5" />
                  Добавить оплату
                </button>
              ) : null}
              {invoice.paidMinor === 0 ? (
                <button
                  type="button"
                  onClick={() => onDialog({ kind: "void-invoice", invoice })}
                  className="focus-ring flex h-9 items-center gap-1.5 rounded-full border border-[var(--danger-border)] bg-[var(--surface)] px-3 text-[10px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"
                  aria-label={`Аннулировать счёт ${invoice.number}`}
                >
                  <Ban className="size-3.5" />
                  Аннулировать
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {invoice.payments.length ? (
        <details className="group mt-3">
          <summary className="focus-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[11px] text-[10px] text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            История оплат · {invoice.payments.length}
          </summary>
          <div className="mt-2">
            {invoice.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                canWrite={canWrite}
                onReverse={() => onDialog({ kind: "reverse-payment", payment })}
              />
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function OrderLedgerCard({
  order,
  canWrite,
  onDialog,
}: {
  order: FinanceOrder;
  canWrite: boolean;
  onDialog: (dialog: FinanceDialog) => void;
}) {
  const remainingToInvoice = Math.max(
    0,
    order.agreedMinor - order.invoicedMinor,
  );
  const settled = order.receivableMinor === 0 && order.invoicedMinor > 0;
  return (
    <article className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(13rem,0.82fr)_minmax(29rem,1.42fr)_auto] xl:items-center">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Заказ
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/orders/${order.id}`}
              className="focus-ring rounded-full font-display text-sm font-semibold text-[var(--text)] hover:text-[var(--accent)]"
            >
              {order.number}
            </Link>
            <span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">
              {statusLabels[order.status] ?? order.status}
            </span>
          </div>
          <p className="mt-2 truncate text-xs font-medium text-[var(--text-secondary)]">
            {order.client}
          </p>
          <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
            {order.object}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 min-[520px]:grid-cols-4">
          <div>
            <dt className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
              Согласовано
            </dt>
            <dd className="mt-1.5 font-display text-xs text-[var(--text)]">
              {formatMoneyMinor(order.agreedMinor)}
            </dd>
          </div>
          <div className="min-[520px]:border-l min-[520px]:border-[var(--line)] min-[520px]:pl-4">
            <dt className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
              Выставлено
            </dt>
            <dd className="mt-1.5 font-display text-xs text-[var(--accent-ink)]">
              {formatMoneyMinor(order.invoicedMinor)}
            </dd>
          </div>
          <div className="min-[520px]:border-l min-[520px]:border-[var(--line)] min-[520px]:pl-4">
            <dt className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
              Получено
            </dt>
            <dd className="mt-1.5 font-display text-xs text-[var(--success)]">
              {formatMoneyMinor(order.paidMinor)}
            </dd>
          </div>
          <div className="min-[520px]:border-l min-[520px]:border-[var(--line)] min-[520px]:pl-4">
            <dt className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
              Долг
            </dt>
            <dd
              className={`mt-1.5 font-display text-xs ${order.receivableMinor > 0 ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}
            >
              {formatMoneyMinor(order.receivableMinor)}
            </dd>
          </div>
        </dl>
        <div className="flex items-center gap-2 xl:justify-end">
          {settled ? (
            <span className="rounded-full border border-[var(--success-border)] bg-[var(--success-bg)] px-3 py-2 text-[10px] text-[var(--success)]">
              Расчёт закрыт
            </span>
          ) : null}
          {canWrite && remainingToInvoice > 0 ? (
            <button
              type="button"
              onClick={() => onDialog({ kind: "invoice", order })}
              className="focus-ring flex h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-4 text-[10px] font-semibold text-[var(--on-accent)] active:translate-y-px hover:bg-[var(--accent-strong)]"
            >
              <FilePlus2 className="size-4" />
              Новый счёт
            </button>
          ) : null}
        </div>
      </div>
      <details className="group mt-5 border-t border-[var(--line)] pt-2">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[13px] text-[10px] text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          Счета и оплаты{" "}
          <span className="rounded-full bg-[var(--surface-soft)] px-2 py-0.5 text-[8px]">
            {order.invoices.length}
          </span>
        </summary>
        <div className="mt-2 border-t border-[var(--line)]">
          {order.invoices.length ? (
            order.invoices.map((invoice) => (
              <InvoiceCard
                key={invoice.id}
                order={order}
                invoice={invoice}
                canWrite={canWrite}
                onDialog={onDialog}
              />
            ))
          ) : (
            <p className="py-3 text-xs text-[var(--muted)]">
              По заказу ещё нет счетов.
            </p>
          )}
        </div>
      </details>
    </article>
  );
}

function PayoutRow({
  payout,
  canWrite,
  onReverse,
}: {
  payout: FinancePayout;
  canWrite: boolean;
  onReverse: () => void;
}) {
  return (
    <article className="rounded-[15px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:grid sm:grid-cols-[minmax(10rem,1.3fr)_8rem_minmax(9rem,1fr)_auto_auto] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-[var(--text)]">
          {payout.masterName}
        </p>
        <Link
          href={`/orders/${payout.orderId}`}
          className="mt-1 block text-[10px] text-[var(--muted)] hover:text-[var(--accent)]"
        >
          Заказ {payout.orderNumber}
        </Link>
      </div>
      <p className="mt-3 text-[10px] text-[var(--muted)] sm:mt-0">
        {formatDate(payout.paidOn)}
      </p>
      <p className="mt-2 truncate text-[10px] text-[var(--text-secondary)] sm:mt-0">
        {methodLabels[payout.method]}
        {payout.reference ? ` · ${payout.reference}` : ""}
        {payout.receiptDocumentId ? (
          <a href={`/api/v1/documents/${payout.receiptDocumentId}/download`} onClick={(event) => event.stopPropagation()} className="focus-ring mt-1 flex items-center gap-1 text-[9px] text-[var(--accent-ink)] hover:text-[var(--accent)]"><ArrowDownToLine className="size-3" />Открыть чек</a>
        ) : null}
      </p>
      <div className="mt-3 sm:mt-0">
        <LedgerStatus
          status={payout.status}
          reversalReason={payout.reversalReason}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 sm:mt-0 sm:justify-end">
        <strong className="font-display text-xs text-[var(--text)]">
          {formatMoneyMinor(payout.amountMinor)}
        </strong>
        {canWrite && payout.status === "posted" ? (
          <button
            type="button"
            onClick={onReverse}
            aria-label={`Сторнировать выплату ${payout.masterName}`}
            className="focus-ring flex h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--danger-border)] bg-[var(--surface)] px-3 text-[9px] text-[var(--danger-ink)] hover:bg-[var(--danger-bg)]"
          >
            <Ban className="size-3.5" />
            Сторно
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function FinanceWorkspace({
  snapshot,
  canWrite,
}: {
  snapshot: FinanceSnapshot;
  canWrite: boolean;
}) {
  const [tab, setTab] = useState<FinanceTab>("receivables");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<FinanceDialog>(null);
  const payoutMasters = useMemo(
    () =>
      Array.from(
        new Set(snapshot.payouts.map((payout) => payout.masterName)),
      ).sort((a, b) => a.localeCompare(b, "ru")),
    [snapshot.payouts],
  );
  const visibleOrders = useMemo(() => {
    const amountMin = parseRubles(filters.amountMin);
    const amountMax = parseRubles(filters.amountMax);
    const visible = snapshot.orders.filter((order) => {
      const hasOverdue = order.invoices.some(
        (invoice) =>
          invoice.status === "issued" &&
          invoice.overdue &&
          invoice.outstandingMinor > 0,
      );
      if (filters.receivableState === "debt" && order.receivableMinor <= 0)
        return false;
      if (filters.receivableState === "overdue" && !hasOverdue) return false;
      if (
        filters.receivableState === "paid" &&
        !(order.invoicedMinor > 0 && order.receivableMinor === 0)
      )
        return false;
      if (
        filters.receivableState === "uninvoiced" &&
        order.invoicedMinor >= order.agreedMinor
      )
        return false;
      if (amountMin !== null && order.receivableMinor < amountMin) return false;
      if (amountMax !== null && order.receivableMinor > amountMax) return false;
      return matchesSearchText(query, [
        order.number,
        order.client,
        order.object,
        ...order.invoices.map((invoice) => invoice.number),
      ]);
    });
    return visible.toSorted((left, right) => {
      if (filters.sort === "debt-asc")
        return left.receivableMinor - right.receivableMinor;
      if (filters.sort === "amount-desc")
        return right.agreedMinor - left.agreedMinor;
      if (filters.sort === "number")
        return left.number.localeCompare(right.number, "ru", { numeric: true });
      return right.receivableMinor - left.receivableMinor;
    });
  }, [filters, query, snapshot.orders]);
  const visiblePayouts = useMemo(() => {
    const dateFrom = parseDateInput(filters.dateFrom);
    const dateTo = parseDateInput(filters.dateTo);
    return snapshot.payouts.filter((payout) => {
      if (filters.ledger !== "all" && payout.status !== filters.ledger)
        return false;
      if (filters.method !== "all" && payout.method !== filters.method)
        return false;
      if (filters.master && payout.masterName !== filters.master) return false;
      if (dateFrom && payout.paidOn < dateFrom) return false;
      if (dateTo && payout.paidOn > dateTo) return false;
      return matchesSearchText(query, [
        payout.masterName,
        payout.orderNumber,
        payout.reference,
      ]);
    });
  }, [filters, query, snapshot.payouts]);
  const closedCustomerPayments = useMemo(
    () => snapshot.orders.flatMap((order) =>
      order.invoices.flatMap((invoice) =>
        invoice.payments
          .filter((payment) => payment.status === "posted")
          .filter((payment) => matchesSearchText(query, [order.number, order.client, order.object, invoice.number, payment.reference]))
          .map((payment) => ({ order, invoice, payment })),
      ),
    ),
    [query, snapshot.orders],
  );
  const closedMasterPayouts = useMemo(
    () => snapshot.payouts.filter((payout) => payout.status === "posted" && matchesSearchText(query, [payout.masterName, payout.orderNumber, payout.reference])),
    [query, snapshot.payouts],
  );
  const payoutOrders = snapshot.orders.filter(
    (order) => order.masterDueMinor > 0 && order.masterId,
  );
  const receivableOverview = useMemo(() => {
    const overdue = visibleOrders.filter((order) =>
      order.invoices.some(
        (invoice) =>
          invoice.status === "issued" &&
          invoice.overdue &&
          invoice.outstandingMinor > 0,
      ),
    );
    const uninvoiced = visibleOrders.filter(
      (order) => order.invoicedMinor < order.agreedMinor,
    );
    const debt = visibleOrders.filter((order) => order.receivableMinor > 0);
    return [
      {
        label: "Просрочено",
        value: overdue.length,
        tone: "text-[var(--danger-ink)]",
      },
      { label: "Есть долг", value: debt.length, tone: "text-[var(--warning)]" },
      {
        label: "Не выставлено",
        value: uninvoiced.length,
        tone: "text-[var(--accent-ink)]",
      },
    ];
  }, [visibleOrders]);
  const activeFilterCount =
    tab === "receivables"
      ? [
          filters.receivableState !== "all",
          Boolean(filters.amountMin),
          Boolean(filters.amountMax),
          filters.sort !== "debt-desc",
        ].filter(Boolean).length
      : tab === "payouts" ? [
          filters.ledger !== "all",
          filters.method !== "all",
          Boolean(filters.master),
          Boolean(filters.dateFrom),
          Boolean(filters.dateTo),
        ].filter(Boolean).length : 0;

  function resetFilters() {
    setQuery("");
    setFilters(defaultFilters);
    setDraftFilters(defaultFilters);
    setFilterError(null);
  }
  function switchTab(nextTab: FinanceTab) {
    setTab(nextTab);
    setFiltersOpen(false);
    setFilterError(null);
  }
  function applyFilters() {
    if (tab === "receivables") {
      if (
        (draftFilters.amountMin &&
          parseRubles(draftFilters.amountMin) === null) ||
        (draftFilters.amountMax && parseRubles(draftFilters.amountMax) === null)
      ) {
        setFilterError("Сумма должна быть положительным числом.");
        return;
      }
      const min = parseRubles(draftFilters.amountMin);
      const max = parseRubles(draftFilters.amountMax);
      if (min !== null && max !== null && min > max) {
        setFilterError(
          "Минимальная задолженность не может превышать максимальную.",
        );
        return;
      }
    } else {
      const from = draftFilters.dateFrom
        ? parseDateInput(draftFilters.dateFrom)
        : null;
      const to = draftFilters.dateTo
        ? parseDateInput(draftFilters.dateTo)
        : null;
      if ((draftFilters.dateFrom && !from) || (draftFilters.dateTo && !to)) {
        setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ.");
        return;
      }
      if (from && to && from > to) {
        setFilterError("Начальная дата не может быть позже конечной.");
        return;
      }
    }
    setFilters(draftFilters);
    setFiltersOpen(false);
  }

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <section className="space-y-4">
        <header className="surface-panel grid gap-5 p-5 lg:grid-cols-[minmax(17rem,0.9fr)_minmax(0,1.1fr)] lg:items-end sm:p-6">
          <div>
            <p className="eyebrow">Денежный реестр</p>
            <div
              role="tablist"
              aria-label="Разделы финансов"
              className="mt-4 inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-inset)] p-1"
            >
              <button
                id="finance-receivables-tab"
                type="button"
                role="tab"
                aria-selected={tab === "receivables"}
                aria-controls="finance-receivables-panel"
                onClick={() => switchTab("receivables")}
                className={
                  "focus-ring h-9 rounded-full px-4 text-xs font-medium transition-colors " +
                  (tab === "receivables"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]")
                }
              >
                Дебиторка
              </button>
              <button
                id="finance-payouts-tab"
                type="button"
                role="tab"
                aria-selected={tab === "payouts"}
                aria-controls="finance-payouts-panel"
                onClick={() => switchTab("payouts")}
                className={
                  "focus-ring h-9 rounded-full px-4 text-xs font-medium transition-colors " +
                  (tab === "payouts"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]")
                }
              >
                Мастера
              </button>
              <button
                id="finance-closed-tab"
                type="button"
                role="tab"
                aria-selected={tab === "closed"}
                aria-controls="finance-closed-panel"
                onClick={() => switchTab("closed")}
                className={
                  "focus-ring h-9 rounded-full px-4 text-xs font-medium transition-colors " +
                  (tab === "closed"
                    ? "bg-[var(--accent)] text-[var(--on-accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]")
                }
              >
                Закрытые
              </button>
            </div>
            <p className="mt-3 max-w-md text-[10px] leading-5 text-[var(--muted)]">
              Счета, оплаты и выплаты хранятся в одной последовательности
              операций.
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-inset)] px-4 text-[var(--muted)] focus-within:border-[var(--line-strong)] sm:max-w-md">
              <Search className="size-4 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  tab === "receivables"
                    ? "Заказ, клиент, объект или счёт"
                    : tab === "payouts"
                      ? "Мастер, заказ или операция"
                      : "Клиент, мастер, заказ или операция"
                }
                className="min-w-0 flex-1 bg-transparent text-xs text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]"
              />
            </label>
            <div className="flex shrink-0 items-center gap-2">
              {tab !== "closed" ? <button
                type="button"
                onClick={() => {
                  setDraftFilters(filters);
                  setFilterError(null);
                  setFiltersOpen(true);
                }}
                className={
                  "focus-ring flex h-10 items-center justify-center gap-2 rounded-full border px-4 text-xs transition-colors " +
                  (activeFilterCount
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    : "border-[var(--line)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]")
                }
              >
                <SlidersHorizontal className="size-3.5" />
                Фильтры
                {activeFilterCount ? (
                  <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button> : null}
              {query.trim() || activeFilterCount ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="focus-ring flex h-10 items-center justify-center gap-2 rounded-full px-3 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                >
                  <RotateCcw className="size-3.5" />
                  <span className="tiny-hidden">Сбросить</span>
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {tab === "receivables" ? (
          <div
            id="finance-receivables-panel"
            role="tabpanel"
            aria-labelledby="finance-receivables-tab"
            className="surface-panel p-5 sm:p-6"
          >
            <section>
              <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[var(--text)]">
                    Расчёты по заказам
                  </h2>
                  <p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">
                    Откройте заказ, чтобы выставить счёт, провести оплату или
                    отменить операцию.
                  </p>
                </div>
                <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-[10px]">
                  {receivableOverview.map((item) => (
                    <div key={item.label} className="flex items-baseline gap-2">
                      <dt className="text-[var(--muted)]">{item.label}</dt>
                      <dd className={"font-display text-base " + item.tone}>
                        {item.value}
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-baseline gap-2">
                    <dt className="text-[var(--muted)]">В реестре</dt>
                    <dd className="font-display text-base text-[var(--text)]">
                      {visibleOrders.length}
                    </dd>
                  </div>
                </dl>
              </header>
              {visibleOrders.length ? (
                <div className="mt-5 space-y-3">
                  {visibleOrders.map((order) => (
                    <OrderLedgerCard
                      key={order.id}
                      order={order}
                      canWrite={canWrite}
                      onDialog={setDialog}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid min-h-64 place-items-center px-6 py-10 text-center">
                  <div>
                    <ReceiptText className="mx-auto size-8 text-[var(--muted-subtle)]" />
                    <p className="mt-4 text-sm text-[var(--text-secondary)]">
                      Ничего не найдено
                    </p>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Измените условия или сбросьте фильтры.
                    </p>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="focus-ring mt-5 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                    >
                      Сбросить фильтры
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : tab === "payouts" ? (
          <div
            id="finance-payouts-panel"
            role="tabpanel"
            aria-labelledby="finance-payouts-tab"
          >
            <div className="space-y-4">
              <section className="surface-panel p-5 sm:p-6">
                <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text)]">
                      К выплате мастерам
                    </h2>
                    <p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">
                      Невыплаченный остаток по заказам с закреплённым
                      исполнителем.
                    </p>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)]">
                    <span className="font-display text-lg text-[var(--support-strong)]">
                      {payoutOrders.length}
                    </span>{" "}
                    {payoutOrders.length === 1
                      ? "заказ ожидает выплату"
                      : "заказов ожидают выплаты"}
                  </p>
                </header>
                {payoutOrders.length ? (
                  <div className="mt-5">
                    {payoutOrders.map((order) => (
                      <article
                        key={order.id}
                        className="grid gap-4 rounded-[15px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 lg:grid-cols-[minmax(12rem,1fr)_minmax(0,1.25fr)_auto] lg:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-[var(--text)]">
                            {order.masterName}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-[var(--muted)]">
                            {order.number} · {order.client}
                          </p>
                        </div>
                        <p className="text-[10px] leading-5 text-[var(--text-secondary)]">
                          Остаток к выплате по заказу. Проведённая сумма сразу
                          попадёт в неизменяемую историю.
                        </p>
                        <div className="flex items-center justify-between gap-4 lg:justify-end">
                          <strong className="font-display text-sm text-[var(--support-strong)]">
                            {formatMoneyMinor(order.masterDueMinor)}
                          </strong>
                          {canWrite ? (
                            <button
                              type="button"
                              onClick={() =>
                                setDialog({ kind: "payout", order })
                              }
                              className="focus-ring flex h-10 items-center gap-2 rounded-full border border-[var(--support-strong)] bg-[var(--support-soft)] px-4 text-[10px] font-medium text-[var(--support-strong)] active:translate-y-px hover:bg-[var(--surface-soft)]"
                            >
                              <WalletCards className="size-3.5" />
                              Провести выплату
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="py-12 text-center text-xs text-[var(--muted)]">
                    Задолженности перед мастерами нет.
                  </p>
                )}
              </section>
              <section className="surface-panel p-5 sm:p-6">
                <header className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text)]">
                      История выплат
                    </h2>
                    <p className="mt-1.5 text-[10px] text-[var(--muted)]">
                      Проведённые и сторнированные операции.
                    </p>
                  </div>
                  <span className="text-[10px] text-[var(--muted)]">
                    {visiblePayouts.length} записей
                  </span>
                </header>
                {visiblePayouts.length ? (
                  <div className="mt-5 space-y-3">
                    {visiblePayouts.map((payout) => (
                      <PayoutRow
                        key={payout.id}
                        payout={payout}
                        canWrite={canWrite}
                        onReverse={() =>
                          setDialog({ kind: "reverse-payout", payout })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className="py-14 text-center text-xs text-[var(--muted)]">
                    Выплат по выбранным условиям нет.
                  </p>
                )}
              </section>
            </div>
          </div>
        ) : (
          <div id="finance-closed-panel" role="tabpanel" aria-labelledby="finance-closed-tab" className="grid gap-4 xl:grid-cols-2">
            <section className="surface-panel p-5 sm:p-6">
              <header className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-4">
                <div><h2 className="text-base font-semibold text-[var(--text)]">Поступления от клиентов</h2><p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">Проведённые оплаты по счетам и прикреплённые подтверждения.</p></div>
                <span className="font-display text-lg text-[var(--text)]">{closedCustomerPayments.length}</span>
              </header>
              <div className="mt-3 space-y-2">
                {closedCustomerPayments.length ? closedCustomerPayments.map(({ order, invoice, payment }) => (
                  <article key={payment.id} className="rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                    <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="truncate text-xs font-semibold text-[var(--text)]">{order.client}</p><Link href={`/orders/${order.id}`} className="mt-1 block truncate text-[10px] text-[var(--muted)] hover:text-[var(--accent-ink)]">{order.number} · счёт {invoice.number}</Link></div><strong className="shrink-0 font-display text-sm text-[var(--success)]">{formatMoneyMinor(payment.amountMinor)}</strong></div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--line)] pt-3 text-[10px] text-[var(--text-secondary)]"><span>{formatDate(payment.receivedOn)}</span><span>{methodLabels[payment.method]}</span>{payment.reference ? <span>{payment.reference}</span> : null}{payment.receiptDocumentId ? <a href={`/api/v1/documents/${payment.receiptDocumentId}/download`} className="focus-ring ml-auto inline-flex items-center gap-1 text-[var(--accent-ink)] hover:text-[var(--accent)]"><ArrowDownToLine className="size-3.5" />Чек</a> : <span className="ml-auto text-[var(--muted)]">Без файла</span>}</div>
                  </article>
                )) : <p className="py-12 text-center text-xs text-[var(--muted)]">Проведённых поступлений не найдено.</p>}
              </div>
            </section>
            <section className="surface-panel p-5 sm:p-6">
              <header className="flex items-end justify-between gap-4 border-b border-[var(--line)] pb-4">
                <div><h2 className="text-base font-semibold text-[var(--text)]">Закрытые выплаты мастерам</h2><p className="mt-1.5 text-[10px] leading-5 text-[var(--muted)]">Проведённые расчёты с исполнителями по заказам.</p></div>
                <span className="font-display text-lg text-[var(--text)]">{closedMasterPayouts.length}</span>
              </header>
              <div className="mt-3 space-y-3">
                {closedMasterPayouts.length ? closedMasterPayouts.map((payout) => <PayoutRow key={payout.id} payout={payout} canWrite={false} onReverse={() => undefined} />) : <p className="py-12 text-center text-xs text-[var(--muted)]">Проведённых выплат не найдено.</p>}
              </div>
            </section>
          </div>
        )}
        <footer className="surface-panel flex items-center justify-between gap-3 px-4 py-3 text-[10px] text-[var(--muted)]">
          <span>
            Показано{" "}
            {tab === "receivables"
              ? visibleOrders.length
              : tab === "payouts"
                ? visiblePayouts.length
                : closedCustomerPayments.length + closedMasterPayouts.length}
          </span>
          <span>
            {activeFilterCount
              ? String(activeFilterCount) + " активных условий"
              : "Без ограничений"}
          </span>
        </footer>
      </section>

      <Dialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title={tab === "receivables" ? "Фильтры дебиторки" : "Фильтры выплат"}
        description={
          tab === "receivables"
            ? "Отберите заказы по состоянию расчётов, размеру долга и порядку отображения."
            : "Найдите выплаты по мастеру, способу, состоянию проводки и дате."
        }
      >
        <div className="space-y-7 p-5 sm:p-7">
          {tab === "receivables" ? (
            <>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Состояние расчётов
                </legend>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  <FilterChoice
                    value="all"
                    current={draftFilters.receivableState}
                    label="Все заказы"
                    onChange={(receivableState) =>
                      setDraftFilters((current) => ({
                        ...current,
                        receivableState,
                      }))
                    }
                  />
                  <FilterChoice
                    value="debt"
                    current={draftFilters.receivableState}
                    label="Есть задолженность"
                    onChange={(receivableState) =>
                      setDraftFilters((current) => ({
                        ...current,
                        receivableState,
                      }))
                    }
                  />
                  <FilterChoice
                    value="overdue"
                    current={draftFilters.receivableState}
                    label="Просроченные счета"
                    onChange={(receivableState) =>
                      setDraftFilters((current) => ({
                        ...current,
                        receivableState,
                      }))
                    }
                  />
                  <FilterChoice
                    value="paid"
                    current={draftFilters.receivableState}
                    label="Оплачено полностью"
                    onChange={(receivableState) =>
                      setDraftFilters((current) => ({
                        ...current,
                        receivableState,
                      }))
                    }
                  />
                  <FilterChoice
                    value="uninvoiced"
                    current={draftFilters.receivableState}
                    label="Не всё выставлено"
                    onChange={(receivableState) =>
                      setDraftFilters((current) => ({
                        ...current,
                        receivableState,
                      }))
                    }
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Размер задолженности
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                      От, ₽
                    </span>
                    <input
                      inputMode="decimal"
                      value={draftFilters.amountMin}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          amountMin: event.target.value,
                        }))
                      }
                      placeholder="0"
                      className={filterInputClass}
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                      До, ₽
                    </span>
                    <input
                      inputMode="decimal"
                      value={draftFilters.amountMax}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          amountMax: event.target.value,
                        }))
                      }
                      placeholder="Без ограничения"
                      className={filterInputClass}
                    />
                  </label>
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Сортировка
                </legend>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  <FilterChoice
                    value="debt-desc"
                    current={draftFilters.sort}
                    label="Сначала большой долг"
                    onChange={(sort) =>
                      setDraftFilters((current) => ({ ...current, sort }))
                    }
                  />
                  <FilterChoice
                    value="debt-asc"
                    current={draftFilters.sort}
                    label="Сначала без долга"
                    onChange={(sort) =>
                      setDraftFilters((current) => ({ ...current, sort }))
                    }
                  />
                  <FilterChoice
                    value="amount-desc"
                    current={draftFilters.sort}
                    label="Сначала крупные заказы"
                    onChange={(sort) =>
                      setDraftFilters((current) => ({ ...current, sort }))
                    }
                  />
                  <FilterChoice
                    value="number"
                    current={draftFilters.sort}
                    label="По номеру заказа"
                    onChange={(sort) =>
                      setDraftFilters((current) => ({ ...current, sort }))
                    }
                  />
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Проводка
                </legend>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                  <FilterChoice
                    value="all"
                    current={draftFilters.ledger}
                    label="Все"
                    onChange={(ledger) =>
                      setDraftFilters((current) => ({ ...current, ledger }))
                    }
                  />
                  <FilterChoice
                    value="posted"
                    current={draftFilters.ledger}
                    label="Проведённые"
                    onChange={(ledger) =>
                      setDraftFilters((current) => ({ ...current, ledger }))
                    }
                  />
                  <FilterChoice
                    value="reversed"
                    current={draftFilters.ledger}
                    label="Сторно"
                    onChange={(ledger) =>
                      setDraftFilters((current) => ({ ...current, ledger }))
                    }
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Способ выплаты
                </legend>
                <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                  <FilterChoice
                    value="all"
                    current={draftFilters.method}
                    label="Любой способ"
                    onChange={(method) =>
                      setDraftFilters((current) => ({ ...current, method }))
                    }
                  />
                  {Object.entries(methodLabels).map(([method, label]) => (
                    <FilterChoice
                      key={method}
                      value={method as PaymentMethod}
                      current={draftFilters.method}
                      label={label}
                      onChange={(selectedMethod) =>
                        setDraftFilters((current) => ({
                          ...current,
                          method: selectedMethod,
                        }))
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Мастер
                </legend>
                <div
                  className="max-h-48 space-y-1 overflow-y-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-1.5"
                  role="radiogroup"
                >
                  <FilterChoice
                    value=""
                    current={draftFilters.master}
                    label="Любой мастер"
                    onChange={(master) =>
                      setDraftFilters((current) => ({ ...current, master }))
                    }
                  />
                  {payoutMasters.map((master) => (
                    <FilterChoice
                      key={master}
                      value={master}
                      current={draftFilters.master}
                      label={master}
                      onChange={(selectedMaster) =>
                        setDraftFilters((current) => ({
                          ...current,
                          master: selectedMaster,
                        }))
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">
                  Дата выплаты
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                      С даты
                    </span>
                    <input
                      inputMode="numeric"
                      value={draftFilters.dateFrom}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          dateFrom: formatDateInput(event.target.value),
                        }))
                      }
                      placeholder="ДД.ММ.ГГГГ"
                      className={filterInputClass}
                    />
                  </label>
                  <label>
                    <span className="mb-2 block text-[10px] text-[var(--text-secondary)]">
                      По дату
                    </span>
                    <input
                      inputMode="numeric"
                      value={draftFilters.dateTo}
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          dateTo: formatDateInput(event.target.value),
                        }))
                      }
                      placeholder="ДД.ММ.ГГГГ"
                      className={filterInputClass}
                    />
                  </label>
                </div>
              </fieldset>
            </>
          )}
          {filterError ? (
            <p
              role="alert"
              className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]"
            >
              {filterError}
            </p>
          ) : null}
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface)]/95 p-4 backdrop-blur-xl sm:p-5">
          <button
            type="button"
            onClick={() => {
              setDraftFilters(defaultFilters);
              setFilterError(null);
            }}
            className="focus-ring h-11 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]"
          >
            <RotateCcw className="mr-2 inline size-3.5" />
            Очистить
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
          >
            {tab === "receivables" ? "Показать заказы" : "Показать выплаты"}
          </button>
        </footer>
      </Dialog>
      <FinanceDialogs
        dialog={dialog}
        today={snapshot.today}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}
