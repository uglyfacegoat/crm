"use client";

import Link from "next/link";
import { Building2, ContactRound, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { Client } from "@/lib/mock-data";
import { matchesSearchText } from "@/lib/search-normalization";

type ClientHistoryFilter = "all" | "with-orders" | "without-orders";
type ClientKindFilter = "all" | Client["kind"];
type ClientSort = "name" | "orders-desc" | "objects-desc";
type ClientAdvancedFilters = { kind: ClientKindFilter; minimumOrders: string; minimumObjects: string; sort: ClientSort };

const defaultAdvancedFilters: ClientAdvancedFilters = { kind: "all", minimumOrders: "", minimumObjects: "", sort: "name" };
const historyOptions: Array<{ value: ClientHistoryFilter; label: string }> = [
  { value: "all", label: "Все клиенты" }, { value: "with-orders", label: "С заказами" }, { value: "without-orders", label: "Без заказов" },
];

function parseNonNegativeInteger(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function Choice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs ${selected ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}>{label}</button>;
}

export function ClientsWorkspace({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<ClientHistoryFilter>("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState(defaultAdvancedFilters);
  const [draft, setDraft] = useState(defaultAdvancedFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const summary = useMemo(() => ({
    objects: clients.reduce((total, client) => total + client.objects, 0),
    orders: clients.reduce((total, client) => total + client.orders, 0),
    active: clients.filter((client) => client.orders > 0).length,
    withoutOrders: clients.filter((client) => client.orders === 0).length,
  }), [clients]);
  const filteredClients = useMemo(() => {
    const minimumOrders = parseNonNegativeInteger(advanced.minimumOrders);
    const minimumObjects = parseNonNegativeInteger(advanced.minimumObjects);
    return clients.filter((client) => {
      if (history === "with-orders" && client.orders === 0) return false;
      if (history === "without-orders" && client.orders > 0) return false;
      if (advanced.kind !== "all" && client.kind !== advanced.kind) return false;
      if (minimumOrders !== null && client.orders < minimumOrders) return false;
      if (minimumObjects !== null && client.objects < minimumObjects) return false;
      return matchesSearchText(query, [client.name, client.contact, client.phone, client.email, client.taxId]);
    }).toSorted((left, right) => {
      if (advanced.sort === "orders-desc") return right.orders - left.orders || left.name.localeCompare(right.name, "ru");
      if (advanced.sort === "objects-desc") return right.objects - left.objects || left.name.localeCompare(right.name, "ru");
      return left.name.localeCompare(right.name, "ru");
    });
  }, [advanced, clients, history, query]);

  const historyCounts = new Map<ClientHistoryFilter, number>([["all", clients.length], ["with-orders", summary.active], ["without-orders", summary.withoutOrders]]);
  const advancedCount = [advanced.kind !== "all", Boolean(advanced.minimumOrders), Boolean(advanced.minimumObjects), advanced.sort !== "name"].filter(Boolean).length;
  const totalFilterCount = advancedCount + (history === "all" ? 0 : 1) + (query.trim() ? 1 : 0);

  function resetFilters() { setQuery(""); setHistory("all"); setAdvanced(defaultAdvancedFilters); setDraft(defaultAdvancedFilters); setFilterError(null); }
  function openAdvancedFilters() { setDraft(advanced); setFilterError(null); setAdvancedOpen(true); }
  function applyAdvancedFilters() {
    if ((draft.minimumOrders && parseNonNegativeInteger(draft.minimumOrders) === null) || (draft.minimumObjects && parseNonNegativeInteger(draft.minimumObjects) === null)) {
      setFilterError("Количество должно быть целым неотрицательным числом.");
      return;
    }
    setAdvanced(draft);
    setAdvancedOpen(false);
  }

  const advancedInputClass = "focus-ring h-11 w-full rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)] focus:border-[var(--accent)]/55";
  const activeClientBadgeClass = "bg-[var(--success-bg)] text-[var(--success)]";
  const inactiveClientBadgeClass = "bg-[var(--surface-soft)] text-[var(--muted)]";

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
      <section className="surface-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--line)] p-4 lg:flex-row lg:items-center">
          <label className="soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 lg:max-w-md">
            <Search className="size-4 text-[var(--muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, ИНН, телефон или e-mail" className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" />
          </label>
          <button type="button" onClick={openAdvancedFilters} className={`focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs ${advancedCount ? "border-[var(--accent)]/45 bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "border-[var(--line)] text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"}`}>
            <SlidersHorizontal className="size-4" />
            Фильтры
            {advancedCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--on-accent)]">{advancedCount}</span> : null}
          </button>
          {totalFilterCount ? <button type="button" onClick={resetFilters} className="focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--text)]"><RotateCcw className="size-3.5" />Сбросить</button> : null}
        </div>

        <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--surface-raised)] px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Фильтр по истории заказов">
            {historyOptions.map((option) => (
              <button key={option.value} type="button" onClick={() => setHistory(option.value)} aria-pressed={history === option.value} className={`focus-ring flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[10px] font-medium ${history === option.value ? "bg-[var(--surface-soft)] text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"}`}>
                {option.label}
                <span className={history === option.value ? "text-[var(--accent)]" : "text-[var(--muted-subtle)]"}>{historyCounts.get(option.value)}</span>
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-4 text-[10px] text-[var(--muted)] sm:ml-auto">
            <span className="flex items-center gap-1.5"><Building2 className="size-3.5 text-[var(--support)]" />{summary.objects} объектов</span>
            <span className="flex items-center gap-1.5"><ContactRound className="size-3.5 text-[var(--accent)]" />{summary.orders} заказов</span>
          </div>
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[830px] text-left">
            <thead className="text-[9px] uppercase tracking-[0.11em] text-[var(--muted)]">
              <tr>{["Клиент", "Основной контакт", "Телефон / e-mail", "Объектов", "Заказов", "Состояние"].map((heading) => <th key={heading} className="px-4 py-3.5 font-medium first:pl-5 last:pr-5">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {filteredClients.map((client) => (
                <tr key={client.id}>
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] font-display text-[10px] text-[var(--accent-ink)]">{client.name.replace(/[^А-ЯA-Z]/g, "").slice(0, 2)}</span><div><Link href={`/clients/${client.id}`} aria-label={`Открыть клиента ${client.name}`} className="focus-ring rounded text-xs font-semibold text-[var(--text)] hover:text-[var(--accent-ink)]">{client.name}</Link><p className="mt-1 text-[9px] text-[var(--muted)]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div></div></td>
                  <td className="px-4 py-3.5 text-xs text-[var(--text-secondary)]">{client.contact}</td>
                  <td className="px-4 py-3.5"><p className="text-xs text-[var(--text-secondary)]">{client.phone}</p><p className="mt-1 text-[9px] text-[var(--muted)]">{client.email}</p></td>
                  <td className="px-4 py-3.5 text-center font-display text-xs text-[var(--text)]">{client.objects}</td>
                  <td className="px-4 py-3.5 text-center font-display text-xs text-[var(--text)]">{client.orders}</td>
                  <td className="px-5 py-3.5"><span className={`rounded-full px-2 py-1 text-[9px] ${client.orders > 0 ? activeClientBadgeClass : inactiveClientBadgeClass}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2 lg:hidden">
          {filteredClients.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`} aria-label={`Открыть клиента ${client.name}`} className="focus-ring block bg-[var(--surface)] p-4 hover:bg-[var(--surface-raised)]">
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-[var(--text)]">{client.name}</h2><p className="mt-1 text-[10px] text-[var(--muted)]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] ${client.orders > 0 ? activeClientBadgeClass : inactiveClientBadgeClass}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></div>
              <p className="mt-4 text-xs text-[var(--text-secondary)]">{client.contact}</p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">{client.phone} · {client.email}</p>
              <div className="mt-4 text-[10px] text-[var(--muted)]">{client.objects} объектов · {client.orders} заказов</div>
            </Link>
          ))}
        </div>

        {filteredClients.length === 0 ? <div className="p-12 text-center"><p className="text-sm text-[var(--muted)]">Клиенты не найдены</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-[var(--surface-soft)] px-3 py-2 text-xs text-[var(--text)] hover:bg-[var(--surface-raised)]">Сбросить фильтры</button></div> : null}
        <footer className="flex items-center justify-between border-t border-[var(--line)] px-4 py-3 text-[10px] text-[var(--muted)] sm:px-5"><span>Показано {filteredClients.length} из {clients.length}</span><span>{totalFilterCount ? `${totalFilterCount} активных условий` : "Без ограничений"}</span></footer>
      </section>

      <Dialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} title="Фильтры клиентов" description="Отберите базу по типу клиента, количеству объектов и истории заказов.">
        <div className="space-y-7 p-5 sm:p-7">
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Тип клиента</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><Choice value="all" current={draft.kind} label="Любой тип" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /><Choice value="Юр. лицо" current={draft.kind} label="Юридические лица" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /><Choice value="Физ. лицо" current={draft.kind} label="Физические лица" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /></div></fieldset>
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Минимальная активность</legend><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-[10px] text-[var(--muted)]">Заказов не менее</span><input inputMode="numeric" value={draft.minimumOrders} onChange={(event) => setDraft((current) => ({ ...current, minimumOrders: event.target.value.replace(/\D/g, "") }))} placeholder="Без ограничения" className={advancedInputClass} /></label><label><span className="mb-2 block text-[10px] text-[var(--muted)]">Объектов не менее</span><input inputMode="numeric" value={draft.minimumObjects} onChange={(event) => setDraft((current) => ({ ...current, minimumObjects: event.target.value.replace(/\D/g, "") }))} placeholder="Без ограничения" className={advancedInputClass} /></label></div></fieldset>
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><Choice value="name" current={draft.sort} label="По названию" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><Choice value="orders-desc" current={draft.sort} label="По заказам" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><Choice value="objects-desc" current={draft.sort} label="По объектам" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /></div></fieldset>
          {filterError ? <p role="alert" className="rounded-[12px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger-ink)]">{filterError}</p> : null}
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-5"><button type="button" onClick={() => { setDraft(defaultAdvancedFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-[var(--line)] px-4 text-xs text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]">Очистить</button><button type="button" onClick={applyAdvancedFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)]">Показать клиентов</button></footer>
      </Dialog>
    </div>
  );
}
