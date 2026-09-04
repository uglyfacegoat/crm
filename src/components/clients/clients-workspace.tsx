"use client";

import { useRouter } from "next/navigation";
import { Building2, ContactRound, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { Client } from "@/lib/mock-data";

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
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs ${selected ? "border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] text-white" : "border-white/[0.07] text-[#858f94] hover:bg-white/[0.035] hover:text-white"}`}>{label}</button>;
}

export function ClientsWorkspace({ clients }: { clients: Client[] }) {
  const router = useRouter();
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
    const normalized = query.trim().toLocaleLowerCase("ru");
    const minimumOrders = parseNonNegativeInteger(advanced.minimumOrders);
    const minimumObjects = parseNonNegativeInteger(advanced.minimumObjects);
    return clients.filter((client) => {
      if (history === "with-orders" && client.orders === 0) return false;
      if (history === "without-orders" && client.orders > 0) return false;
      if (advanced.kind !== "all" && client.kind !== advanced.kind) return false;
      if (minimumOrders !== null && client.orders < minimumOrders) return false;
      if (minimumObjects !== null && client.objects < minimumObjects) return false;
      return !normalized || [client.name, client.contact, client.phone, client.email, client.taxId ?? ""].some((value) => value.toLocaleLowerCase("ru").includes(normalized));
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

  return <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
    <section className="surface-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 lg:flex-row lg:items-center">
        <label className="soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 lg:max-w-md"><Search className="size-4 text-[#6d777d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, ИНН, телефон или e-mail" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#59636a]" /></label>
        <button type="button" onClick={openAdvancedFilters} className={`focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border px-3 text-xs ${advancedCount ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] text-white" : "border-white/[0.07] text-[#858f94]"}`}><SlidersHorizontal className="size-4" />Фильтры{advancedCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[#25272c]">{advancedCount}</span> : null}</button>
        {totalFilterCount ? <button type="button" onClick={resetFilters} className="focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-3 text-xs text-[#7b858b]"><RotateCcw className="size-3.5" />Сбросить</button> : null}
      </div>
      <div className="flex flex-col gap-3 border-b border-white/[0.055] bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Фильтр по истории заказов">{historyOptions.map((option) => <button key={option.value} type="button" onClick={() => setHistory(option.value)} aria-pressed={history === option.value} className={`focus-ring flex h-9 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[10px] font-medium ${history === option.value ? "bg-white/[0.09] text-white" : "text-[#737d83] hover:bg-white/[0.035] hover:text-white"}`}>{option.label}<span className={history === option.value ? "text-[var(--accent)]" : "text-[#505a60]"}>{historyCounts.get(option.value)}</span></button>)}</div>
        <div className="flex shrink-0 items-center gap-4 text-[10px] text-[#626c72] sm:ml-auto"><span className="flex items-center gap-1.5"><Building2 className="size-3.5 text-[#55c9bc]" />{summary.objects} объектов</span><span className="flex items-center gap-1.5"><ContactRound className="size-3.5 text-[#b8f7e4]" />{summary.orders} заказов</span></div>
      </div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[830px] text-left"><thead className="text-[9px] uppercase tracking-[0.11em] text-[#626c72]"><tr>{["Клиент", "Основной контакт", "Телефон / e-mail", "Объектов", "Заказов", "Состояние"].map((heading) => <th key={heading} className="px-4 py-3.5 font-medium first:pl-5 last:pr-5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.05]">{filteredClients.map((client) => <tr key={client.id} role="link" tabIndex={0} aria-label={`Открыть клиента ${client.name}`} onClick={() => router.push(`/clients/${client.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/clients/${client.id}`); } }} className="cursor-pointer hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]">
        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)]/10 font-display text-[10px] text-[var(--accent)]">{client.name.replace(/[^А-ЯA-Z]/g, "").slice(0, 2)}</span><div><span className="text-xs font-semibold text-white">{client.name}</span><p className="mt-1 text-[9px] text-[#707a80]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div></div></td>
        <td className="px-4 py-3.5 text-xs text-[#c8ced1]">{client.contact}</td><td className="px-4 py-3.5"><p className="text-xs text-[#a5adb1]">{client.phone}</p><p className="mt-1 text-[9px] text-[#707a80]">{client.email}</p></td><td className="px-4 py-3.5 text-center font-display text-xs text-white">{client.objects}</td><td className="px-4 py-3.5 text-center font-display text-xs text-white">{client.orders}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2 py-1 text-[9px] ${client.orders > 0 ? "bg-[#49d49d]/10 text-[#64dcae]" : "bg-white/[0.05] text-[#7a848a]"}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></td>
      </tr>)}</tbody></table></div>
      <div className="grid gap-px bg-white/[0.055] sm:grid-cols-2 lg:hidden">{filteredClients.map((client) => <article key={client.id} role="link" tabIndex={0} aria-label={`Открыть клиента ${client.name}`} onClick={() => router.push(`/clients/${client.id}`)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/clients/${client.id}`); } }} className="cursor-pointer bg-[var(--surface)] p-4 hover:bg-white/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">{client.name}</h2><p className="mt-1 text-[10px] text-[#6f797f]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] ${client.orders > 0 ? "bg-[#49d49d]/10 text-[#64dcae]" : "bg-white/[0.05] text-[#7a848a]"}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></div><p className="mt-4 text-xs text-[#a1a9ad]">{client.contact}</p><p className="mt-1 text-[10px] text-[#707a80]">{client.phone} · {client.email}</p><div className="mt-4 text-[10px] text-[#788289]">{client.objects} объектов · {client.orders} заказов</div></article>)}</div>
      {filteredClients.length === 0 ? <div className="p-12 text-center"><p className="text-sm text-[#899298]">Клиенты не найдены</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-white/[0.07] px-3 py-2 text-xs text-white">Сбросить фильтры</button></div> : null}
      <footer className="flex items-center justify-between border-t border-white/[0.055] px-4 py-3 text-[10px] text-[#667078] sm:px-5"><span>Показано {filteredClients.length} из {clients.length}</span><span>{totalFilterCount ? `${totalFilterCount} активных условий` : "Без ограничений"}</span></footer>
    </section>

    <Dialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} title="Фильтры клиентов" description="Отберите базу по типу клиента, количеству объектов и истории заказов.">
      <div className="space-y-7 p-5 sm:p-7">
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Тип клиента</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><Choice value="all" current={draft.kind} label="Любой тип" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /><Choice value="Юр. лицо" current={draft.kind} label="Юридические лица" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /><Choice value="Физ. лицо" current={draft.kind} label="Физические лица" onChange={(kind) => setDraft((current) => ({ ...current, kind }))} /></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Минимальная активность</legend><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-[10px] text-[#747e84]">Заказов не менее</span><input inputMode="numeric" value={draft.minimumOrders} onChange={(event) => setDraft((current) => ({ ...current, minimumOrders: event.target.value.replace(/\D/g, "") }))} placeholder="Без ограничения" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label><label><span className="mb-2 block text-[10px] text-[#747e84]">Объектов не менее</span><input inputMode="numeric" value={draft.minimumObjects} onChange={(event) => setDraft((current) => ({ ...current, minimumObjects: event.target.value.replace(/\D/g, "") }))} placeholder="Без ограничения" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><Choice value="name" current={draft.sort} label="По названию" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><Choice value="orders-desc" current={draft.sort} label="По заказам" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><Choice value="objects-desc" current={draft.sort} label="По объектам" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /></div></fieldset>
        {filterError ? <p role="alert" className="rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.055] p-3 text-xs text-[#dc898e]">{filterError}</p> : null}
      </div>
      <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-white/[0.07] bg-[#25272c]/95 p-4 backdrop-blur-xl sm:p-5"><button type="button" onClick={() => { setDraft(defaultAdvancedFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#899399]">Очистить</button><button type="button" onClick={applyAdvancedFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#25272c]">Показать клиентов</button></footer>
    </Dialog>
  </div>;
}
