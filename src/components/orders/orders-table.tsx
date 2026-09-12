"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronRight, Grid2X2, List, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import { matchesSearchText } from "@/lib/search-normalization";
import type { OrderDisplayStatus, OrderListItem } from "@/server/orders/types";

const statusOptions: Array<OrderDisplayStatus | "Все"> = ["Все", "Новый", "В работе", "На согласовании", "Запланирован", "Выполнен", "Просрочен", "Отменён"];
type AssignmentFilter = "all" | "assigned" | "unassigned";
type OrderSort = "newest" | "oldest" | "amount-desc" | "amount-asc";
type AdvancedFilters = { assignment: AssignmentFilter; master: string; dateFrom: string; dateTo: string; amountMin: string; amountMax: string; sort: OrderSort };

const defaultAdvancedFilters: AdvancedFilters = { assignment: "all", master: "", dateFrom: "", dateTo: "", amountMin: "", amountMax: "", sort: "newest" };
const sortOptions: Array<{ value: OrderSort; label: string }> = [
  { value: "newest", label: "Сначала новые" }, { value: "oldest", label: "Сначала старые" },
  { value: "amount-desc", label: "Сначала дорогие" }, { value: "amount-asc", label: "Сначала недорогие" },
];
const assignmentOptions: Array<{ value: AssignmentFilter; label: string }> = [
  { value: "all", label: "Любое назначение" }, { value: "assigned", label: "Мастер назначен" }, { value: "unassigned", label: "Без мастера" },
];

function parseRubles(value: string) {
  if (!value.trim()) return null;
  const amount = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function activeAdvancedFilterCount(filters: AdvancedFilters) {
  return [filters.assignment !== "all", Boolean(filters.master), Boolean(filters.dateFrom), Boolean(filters.dateTo), Boolean(filters.amountMin), Boolean(filters.amountMax), filters.sort !== "newest"].filter(Boolean).length;
}

function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{label}</button>;
}

export function OrdersTable({ orders }: { orders: OrderListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrderDisplayStatus | "Все">("Все");
  const [view, setView] = useState<"list" | "grid">("list");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState(defaultAdvancedFilters);
  const [draft, setDraft] = useState(defaultAdvancedFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const masters = useMemo(() => Array.from(new Set(orders.flatMap((order) => order.master ? [order.master] : []))).sort((a, b) => a.localeCompare(b, "ru")), [orders]);
  const statusCounts = useMemo(() => new Map(statusOptions.map((option) => [option, option === "Все" ? orders.length : orders.filter((order) => order.status === option).length])), [orders]);

  const filteredOrders = useMemo(() => {
    const dateFrom = parseDateInput(advanced.dateFrom);
    const dateTo = parseDateInput(advanced.dateTo);
    const amountMin = parseRubles(advanced.amountMin);
    const amountMax = parseRubles(advanced.amountMax);
    const visible = orders.filter((order) => {
      if (status !== "Все" && order.status !== status) return false;
      if (advanced.assignment === "assigned" && !order.master) return false;
      if (advanced.assignment === "unassigned" && order.master) return false;
      if (advanced.master && order.master !== advanced.master) return false;
      if (dateFrom && order.createdAt.slice(0, 10) < dateFrom) return false;
      if (dateTo && order.createdAt.slice(0, 10) > dateTo) return false;
      if (amountMin !== null && order.agreedTotalMinor < amountMin) return false;
      if (amountMax !== null && order.agreedTotalMinor > amountMax) return false;
      return matchesSearchText(query, [order.number, order.client, order.object, order.address, order.serviceSummary, order.master]);
    });
    return visible.toSorted((left, right) => {
      if (advanced.sort === "oldest") return left.createdAt.localeCompare(right.createdAt);
      if (advanced.sort === "amount-desc") return right.agreedTotalMinor - left.agreedTotalMinor;
      if (advanced.sort === "amount-asc") return left.agreedTotalMinor - right.agreedTotalMinor;
      return right.createdAt.localeCompare(left.createdAt);
    });
  }, [advanced, orders, query, status]);

  function openAdvancedFilters() { setDraft(advanced); setFilterError(null); setAdvancedOpen(true); }
  function applyAdvancedFilters() {
    const from = draft.dateFrom ? parseDateInput(draft.dateFrom) : null;
    const to = draft.dateTo ? parseDateInput(draft.dateTo) : null;
    if ((draft.dateFrom && !from) || (draft.dateTo && !to)) { setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ."); return; }
    if (from && to && from > to) { setFilterError("Начальная дата не может быть позже конечной."); return; }
    if ((draft.amountMin && parseRubles(draft.amountMin) === null) || (draft.amountMax && parseRubles(draft.amountMax) === null)) { setFilterError("Сумма должна быть положительным числом."); return; }
    const min = parseRubles(draft.amountMin);
    const max = parseRubles(draft.amountMax);
    if (min !== null && max !== null && min > max) { setFilterError("Минимальная сумма не может превышать максимальную."); return; }
    setAdvanced(draft); setAdvancedOpen(false);
  }
  function resetFilters() { setQuery(""); setStatus("Все"); setAdvanced(defaultAdvancedFilters); setDraft(defaultAdvancedFilters); setFilterError(null); }

  const advancedCount = activeAdvancedFilterCount(advanced);
  const totalFilterCount = advancedCount + (status === "Все" ? 0 : 1) + (query.trim() ? 1 : 0);

  return <div className="animate-rise" style={{ animationDelay: "100ms" }}>
    <section className="surface-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] p-3.5 min-[420px]:p-4 lg:flex-row lg:items-center lg:justify-between sm:px-5 2xl:py-5">
        <label className="soft-button flex h-10 min-w-0 items-center gap-2 rounded-[13px] px-3 sm:w-80 2xl:w-96"><Search className="size-4 shrink-0 text-[var(--muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" placeholder="Номер, клиент, адрес, услуга или мастер" /></label>
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2 sm:pb-0">
          <button type="button" onClick={openAdvancedFilters} className={`focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[11px] border px-3 text-xs ${advancedCount ? "border-[var(--accent)]/35 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--text-secondary)] hover:text-[var(--text)]"}`}><SlidersHorizontal className="size-4" />Фильтры{advancedCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">{advancedCount}</span> : null}</button>
          {totalFilterCount ? <button type="button" onClick={resetFilters} className="focus-ring flex h-10 shrink-0 items-center gap-2 rounded-[11px] border border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:text-[var(--text)]"><RotateCcw className="size-3.5" />Сбросить</button> : null}
          <div className="ml-auto flex shrink-0 rounded-[11px] border border-[var(--line)] p-1"><button type="button" onClick={() => setView("list")} aria-label="Показать списком" aria-pressed={view === "list"} className={`grid size-8 place-items-center rounded-[8px] ${view === "list" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)]"}`}><List className="size-4" /></button><button type="button" onClick={() => setView("grid")} aria-label="Показать карточками" aria-pressed={view === "grid"} className={`grid size-8 place-items-center rounded-[8px] ${view === "grid" ? "bg-[var(--accent)] text-[var(--on-accent)]" : "text-[var(--muted)]"}`}><Grid2X2 className="size-4" /></button></div>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--line)] bg-[var(--surface-inset)] px-4 py-3 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden" aria-label="Фильтр по статусу">{statusOptions.map((option) => <button key={option} type="button" onClick={() => setStatus(option)} aria-pressed={status === option} className={`focus-ring flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[10px] font-medium transition-colors ${status === option ? "bg-[var(--surface-raised)] text-[var(--text)] ring-1 ring-[var(--line-strong)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>{option}<span className={status === option ? "text-[var(--accent)]" : "text-[var(--muted-subtle)]"}>{statusCounts.get(option)}</span></button>)}</div>
      <div className={`${view === "list" ? "hidden lg:block" : "hidden"} overflow-x-auto`}><table className="w-full min-w-[900px] text-left"><thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]"><tr><th className="px-5 py-3 font-medium">№ заказа</th><th className="px-4 py-3 font-medium">Клиент</th><th className="px-4 py-3 font-medium">Объект</th><th className="px-4 py-3 font-medium">Дата</th><th className="px-4 py-3 font-medium">Мастер</th><th className="px-4 py-3 font-medium">Статус</th><th className="px-5 py-3 text-right font-medium">Сумма</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{filteredOrders.map((order) => <tr key={order.id} role="link" tabIndex={0} aria-label={`Открыть заказ ${order.number}`} onClick={() => router.push(`/orders/${order.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/orders/${order.id}`); } }} className="group cursor-pointer transition-colors hover:bg-[var(--surface-raised)] focus-visible:bg-[var(--surface-raised)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px]"><td className="px-5 py-4"><Link href={`/orders/${order.id}`} className="focus-ring rounded font-display text-[11px] font-semibold text-[var(--text)] transition-colors hover:text-[var(--accent)]">{order.number}</Link></td><td className="px-4 py-4 text-xs font-medium text-[var(--text)]">{order.client}</td><td className="px-4 py-4"><p className="text-xs text-[var(--text-secondary)]">{order.object}</p><p className="mt-1 text-[10px] text-[var(--muted)]">{order.address}</p></td><td className="px-4 py-4 text-xs text-[var(--text-secondary)]">{formatShortDate(order.createdAt)}</td><td className={`px-4 py-4 text-xs ${order.master ? "text-[var(--text-secondary)]" : "text-[var(--danger-ink)]"}`}>{order.master ?? "Не назначен"}</td><td className="px-4 py-4"><StatusBadge status={order.status} /></td><td className="px-5 py-4 text-right font-display text-[11px] text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</td></tr>)}</tbody></table></div>
      <div className={`${view === "list" ? "divide-y divide-[var(--line)] lg:hidden" : "grid gap-px bg-[var(--line)] sm:grid-cols-2 xl:grid-cols-3"}`}>{filteredOrders.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="focus-ring block bg-[var(--surface)] p-4 transition-colors duration-200 hover:bg-[var(--surface-raised)] sm:px-5"><div className="flex items-start justify-between gap-3"><div><p className="font-display text-[11px] font-semibold text-[var(--text)]">{order.number}</p><p className="mt-2 text-sm font-medium text-[var(--text)]">{order.client}</p><p className="mt-1 text-xs text-[var(--muted)]">{order.object} · {order.address}</p></div><ChevronRight className="mt-1 size-4 text-[var(--muted)]" /></div><div className="mt-4 flex items-center justify-between gap-2"><StatusBadge status={order.status} /><span className="font-display text-xs text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</span></div></Link>)}</div>
      {!filteredOrders.length ? <div className="px-5 py-16 text-center"><p className="text-sm font-medium text-[var(--text)]">Заказы не найдены</p><p className="mt-2 text-xs text-[var(--muted)]">Измените условия или сбросьте фильтры.</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-[var(--surface-soft)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--accent-soft)]">Сбросить фильтры</button></div> : null}
      <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3.5 text-[11px] text-[var(--muted)] sm:px-5 sm:text-xs"><span>Показано {filteredOrders.length} из {orders.length}</span><span className="text-right">{totalFilterCount ? `${totalFilterCount} активных условий` : "Без ограничений"}</span></div>
    </section>

    <Dialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} title="Фильтры заказов" description="Сузьте список по назначению, мастеру, периоду, сумме и порядку отображения.">
      <div className="space-y-7 p-5 sm:p-7">
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Назначение</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup">{assignmentOptions.map((option) => <FilterChoice key={option.value} value={option.value} current={draft.assignment} label={option.label} onChange={(assignment) => setDraft((current) => ({ ...current, assignment, master: assignment === "unassigned" ? "" : current.master }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Мастер</legend><div className="max-h-48 space-y-1 overflow-y-auto rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] p-1.5" role="radiogroup"><FilterChoice value="" current={draft.master} label="Любой мастер" onChange={(master) => setDraft((current) => ({ ...current, master }))} />{masters.map((master) => <FilterChoice key={master} value={master} current={draft.master} label={master} onChange={(selectedMaster) => setDraft((current) => ({ ...current, master: selectedMaster, assignment: "assigned" }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]"><CalendarRange className="size-3.5" />Дата создания</legend><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-[10px] text-[var(--muted)]">С даты</span><input inputMode="numeric" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/60" /></label><label className="block"><span className="mb-2 block text-[10px] text-[var(--muted)]">По дату</span><input inputMode="numeric" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/60" /></label></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Согласованная сумма</legend><div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-2 block text-[10px] text-[var(--muted)]">От, ₽</span><input inputMode="decimal" value={draft.amountMin} onChange={(event) => setDraft((current) => ({ ...current, amountMin: event.target.value }))} placeholder="0" className="h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/60" /></label><label className="block"><span className="mb-2 block text-[10px] text-[var(--muted)]">До, ₽</span><input inputMode="decimal" value={draft.amountMax} onChange={(event) => setDraft((current) => ({ ...current, amountMax: event.target.value }))} placeholder="Без ограничения" className="h-11 w-full rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/60" /></label></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup">{sortOptions.map((option) => <FilterChoice key={option.value} value={option.value} current={draft.sort} label={option.label} onChange={(sort) => setDraft((current) => ({ ...current, sort }))} />)}</div></fieldset>
        {filterError ? <p role="alert" className="rounded-[12px] border border-[var(--danger-border)]/45 bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]">{filterError}</p> : null}
      </div>
      <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)]/95 p-4 backdrop-blur-xl sm:p-5"><button type="button" onClick={() => { setDraft(defaultAdvancedFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-[var(--line-strong)] px-4 text-xs text-[var(--text-secondary)] hover:text-[var(--text)]"><RotateCcw className="mr-2 inline size-3.5" />Очистить</button><button type="button" onClick={applyAdvancedFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]">Показать заказы</button></footer>
    </Dialog>
  </div>;
}
