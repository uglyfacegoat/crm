"use client";

import { CalendarClock, CalendarRange, ChevronRight, FileSignature, History, Pencil, RefreshCw, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ContractDialogs, NewContractButton, type ContractDialogMode } from "@/components/contracts/contract-dialogs";
import { Dialog } from "@/components/ui/dialog";
import { formatDateInput, parseDateInput } from "@/lib/date-input";
import type { ContractListItem, ContractSnapshot, ContractStatus } from "@/server/contracts/types";

type QuickFilter = "all" | "active" | "expiring" | "scheduled";
type ScheduleFilter = "all" | "scheduled" | "unscheduled";
type ExpiryFilter = "all" | "attention" | "expired";
type ContractSort = "expiry-asc" | "expiry-desc" | "newest" | "oldest";
type AdvancedFilters = { status: "all" | ContractStatus; schedule: ScheduleFilter; expiry: ExpiryFilter; dateFrom: string; dateTo: string; master: string; sort: ContractSort };

const defaultAdvancedFilters: AdvancedFilters = { status: "all", schedule: "all", expiry: "all", dateFrom: "", dateTo: "", master: "", sort: "expiry-asc" };
const statuses: Array<{ value: "all" | ContractStatus; label: string }> = [
  { value: "all", label: "Любой статус" }, { value: "active", label: "Действует" }, { value: "draft", label: "Черновик" },
  { value: "suspended", label: "Приостановлен" }, { value: "completed", label: "Завершён" }, { value: "cancelled", label: "Отменён" },
];
const quickFilters: Array<{ value: QuickFilter; label: string; tone: string }> = [
  { value: "all", label: "Все договоры", tone: "#edf43b" }, { value: "active", label: "Действуют", tone: "#69d3a4" },
  { value: "expiring", label: "Требуют продления", tone: "#efb454" }, { value: "scheduled", label: "С плановыми выездами", tone: "#9c82e8" },
];
const statusPresentation = {
  draft: { label: "Черновик", className: "border-white/[0.1] bg-white/[0.04] text-[#9da5aa]" },
  active: { label: "Действует", className: "border-[#69d3a4]/25 bg-[#69d3a4]/[0.07] text-[#78d4aa]" },
  suspended: { label: "Приостановлен", className: "border-[#efb454]/25 bg-[#efb454]/[0.07] text-[#e8b666]" },
  completed: { label: "Завершён", className: "border-[#66b6eb]/20 bg-[#66b6eb]/[0.06] text-[#79bce7]" },
  cancelled: { label: "Отменён", className: "border-[#ef646a]/20 bg-[#ef646a]/[0.06] text-[#dc7c81]" },
} as const;

function formatDate(date: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${date}T12:00:00Z`)); }
function formatDateTime(date: string) { return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(date)); }
function frequencyLabel(contract: ContractListItem) {
  if (!contract.schedule) return "Без графика";
  return `Каждые ${contract.schedule.frequencyInterval} ${contract.schedule.frequencyUnit === "month" ? "мес." : "нед."} · ${contract.schedule.localTime}`;
}
function expiryLabel(contract: ContractListItem) {
  if (contract.daysUntilEnd < 0) return `Истёк ${formatDate(contract.endsOn)}`;
  if (contract.daysUntilEnd === 0) return "Истекает сегодня";
  if (contract.daysUntilEnd <= contract.renewalNoticeDays) return `До окончания ${contract.daysUntilEnd} дн.`;
  return `До ${formatDate(contract.endsOn)}`;
}
function activeAdvancedFilterCount(filters: AdvancedFilters) {
  return [filters.status !== "all", filters.schedule !== "all", filters.expiry !== "all", Boolean(filters.dateFrom), Boolean(filters.dateTo), Boolean(filters.master), filters.sort !== "expiry-asc"].filter(Boolean).length;
}
function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] text-white" : "border-white/[0.07] text-[#858f94] hover:bg-white/[0.035] hover:text-white"}`}>{label}</button>;
}

export function ContractsWorkspace({ snapshot, canWrite }: { snapshot: ContractSnapshot; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advanced, setAdvanced] = useState(defaultAdvancedFilters);
  const [draft, setDraft] = useState(defaultAdvancedFilters);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<ContractDialogMode>(null);
  const selected = snapshot.contracts.find((contract) => contract.id === selectedId) ?? null;
  const masters = useMemo(() => Array.from(new Set(snapshot.contracts.flatMap((contract) => contract.schedule?.defaultMasterName ? [contract.schedule.defaultMasterName] : []))).sort((a, b) => a.localeCompare(b, "ru")), [snapshot.contracts]);
  const counts: Record<QuickFilter, number> = {
    all: snapshot.summary.total,
    active: snapshot.summary.active,
    expiring: snapshot.summary.expiring,
    scheduled: snapshot.contracts.filter((contract) => contract.schedule).length,
  };
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    const dateFrom = parseDateInput(advanced.dateFrom);
    const dateTo = parseDateInput(advanced.dateTo);
    const filtered = snapshot.contracts.filter((contract) => {
      if (quickFilter === "active" && contract.status !== "active") return false;
      if (quickFilter === "expiring" && !(contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= contract.renewalNoticeDays)) return false;
      if (quickFilter === "scheduled" && !contract.schedule) return false;
      if (advanced.status !== "all" && contract.status !== advanced.status) return false;
      if (advanced.schedule === "scheduled" && !contract.schedule) return false;
      if (advanced.schedule === "unscheduled" && contract.schedule) return false;
      if (advanced.expiry === "attention" && !(contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= contract.renewalNoticeDays)) return false;
      if (advanced.expiry === "expired" && contract.daysUntilEnd >= 0) return false;
      if (dateFrom && contract.endsOn < dateFrom) return false;
      if (dateTo && contract.endsOn > dateTo) return false;
      if (advanced.master && contract.schedule?.defaultMasterName !== advanced.master) return false;
      return !normalized || `${contract.contractNumber} ${contract.clientName} ${contract.objectName} ${contract.objectAddress} ${contract.schedule?.defaultMasterName ?? ""}`.toLocaleLowerCase("ru-RU").includes(normalized);
    });
    return filtered.toSorted((left, right) => {
      if (advanced.sort === "expiry-desc") return right.endsOn.localeCompare(left.endsOn);
      if (advanced.sort === "newest") return right.startsOn.localeCompare(left.startsOn);
      if (advanced.sort === "oldest") return left.startsOn.localeCompare(right.startsOn);
      return left.endsOn.localeCompare(right.endsOn);
    });
  }, [advanced, query, quickFilter, snapshot.contracts]);

  function open(contract: ContractListItem, mode: Exclude<ContractDialogMode, "create" | null>) { setSelectedId(contract.id); setDialogMode(mode); }
  function close() { setDialogMode(null); setSelectedId(null); }
  function openAdvancedFilters() { setDraft(advanced); setFilterError(null); setAdvancedOpen(true); }
  function applyAdvancedFilters() {
    const from = draft.dateFrom ? parseDateInput(draft.dateFrom) : null;
    const to = draft.dateTo ? parseDateInput(draft.dateTo) : null;
    if ((draft.dateFrom && !from) || (draft.dateTo && !to)) { setFilterError("Введите дату полностью в формате ДД.ММ.ГГГГ."); return; }
    if (from && to && from > to) { setFilterError("Начальная дата не может быть позже конечной."); return; }
    setAdvanced(draft); setAdvancedOpen(false);
  }
  function resetFilters() { setQuery(""); setQuickFilter("all"); setAdvanced(defaultAdvancedFilters); setDraft(defaultAdvancedFilters); setFilterError(null); }

  const advancedCount = activeAdvancedFilterCount(advanced);
  const totalFilterCount = advancedCount + (quickFilter === "all" ? 0 : 1) + (query.trim() ? 1 : 0);

  return <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] space-y-4">
    <section aria-label="Быстрые фильтры договоров" className="grid overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.025] min-[620px]:grid-cols-2 xl:grid-cols-4">{quickFilters.map((entry) => <button key={entry.value} type="button" onClick={() => setQuickFilter(entry.value)} aria-pressed={quickFilter === entry.value} className={`focus-ring flex min-h-[76px] items-center gap-3 border-b border-white/[0.06] px-4 text-left transition-colors last:border-b-0 min-[620px]:border-r xl:border-b-0 ${quickFilter === entry.value ? "bg-white/[0.055]" : "hover:bg-white/[0.025]"}`}><span className="size-2 rounded-full" style={{ backgroundColor: entry.tone }} /><span className="min-w-0 flex-1"><span className="block text-[10px] text-[#748087]">{entry.label}</span><strong className="mt-1 block font-display text-lg text-white">{counts[entry.value]}</strong></span></button>)}</section>

    <section className="surface-panel overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-white/[0.07] p-3 sm:p-4 lg:flex-row lg:items-center">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-white/[0.08] bg-black/10 px-3 lg:max-w-md"><Search className="size-4 shrink-0 text-[#657078]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент, объект, адрес или мастер" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#59636a]" /></label>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto"><button type="button" onClick={openAdvancedFilters} className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border px-3 text-xs ${advancedCount ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] text-white" : "border-white/[0.07] text-[#858f94]"}`}><SlidersHorizontal className="size-4" />Фильтры{advancedCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[#101308]">{advancedCount}</span> : null}</button>{totalFilterCount ? <button type="button" onClick={resetFilters} className="focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border border-white/[0.07] px-3 text-xs text-[#7c858b]"><RotateCcw className="size-3.5" />Сбросить</button> : null}<span className="ml-auto shrink-0 text-[10px] text-[#667077]">{visible.length} из {snapshot.contracts.length}{totalFilterCount ? ` · ${totalFilterCount} активных условий` : ""}</span></div>
        {canWrite ? <NewContractButton onClick={() => setDialogMode("create")} /> : null}
      </header>

      <div className="hidden min-w-[68rem] grid-cols-[minmax(12rem,1.2fr)_minmax(15rem,1.8fr)_9rem_10rem_11rem_8rem] items-center gap-4 border-b border-white/[0.06] px-5 py-3 text-[9px] uppercase tracking-[0.1em] text-[#5f696f] lg:grid"><span>Договор</span><span>Клиент / объект</span><span>Период</span><span>График</span><span>Следующий выезд</span><span className="text-right">Действия</span></div>
      <div>{visible.map((contract) => { const presentation = statusPresentation[contract.status]; return <article key={contract.id} className="border-b border-white/[0.055] p-4 last:border-0 lg:grid lg:min-w-[68rem] lg:grid-cols-[minmax(12rem,1.2fr)_minmax(15rem,1.8fr)_9rem_10rem_11rem_8rem] lg:items-center lg:gap-4 lg:px-5 lg:py-4">
        <div className="flex items-start justify-between gap-3 lg:block"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-white">{contract.contractNumber}</h2><span className={`rounded-[7px] border px-2 py-1 text-[9px] ${presentation.className}`}>{presentation.label}</span></div><p className={`mt-2 text-[10px] ${contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= contract.renewalNoticeDays ? "text-[#efb454]" : "text-[#69737a]"}`}>{expiryLabel(contract)}</p></div><button type="button" onClick={() => open(contract, "history")} aria-label={`История договора ${contract.contractNumber}`} className="focus-ring grid size-9 shrink-0 place-items-center rounded-[10px] border border-white/[0.07] text-[#737d83] lg:hidden"><History className="size-4" /></button></div>
        <div className="mt-4 min-w-0 lg:mt-0"><p className="truncate text-xs font-medium text-[#dce1de]">{contract.clientName}</p><p className="mt-1 truncate text-[10px] text-[#788289]">{contract.objectName} · {contract.objectAddress}</p>{contract.renewedFromContractId ? <p className="mt-1 text-[9px] text-[#9c82e8]">Продление предыдущего периода</p> : null}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:mt-0 lg:block"><div><p className="text-[9px] text-[#5f696f] lg:hidden">Начало</p><p className="mt-1 text-[10px] text-[#a3abae]">{formatDate(contract.startsOn)}</p></div><div><p className="text-[9px] text-[#5f696f] lg:hidden">Окончание</p><p className="mt-1 text-[10px] text-[#a3abae]">{formatDate(contract.endsOn)}</p></div></div>
        <div className="mt-4 lg:mt-0"><p className="text-[10px] text-[#a3abae]">{frequencyLabel(contract)}</p><p className="mt-1 text-[9px] text-[#626c72]">{contract.schedule ? `${contract.schedule.visitCount} дат${contract.schedule.defaultMasterName ? ` · ${contract.schedule.defaultMasterName}` : ""}` : "Можно добавить при продлении"}</p></div>
        <div className="mt-4 lg:mt-0">{contract.nextVisitAt ? <Link href="/calendar" className="focus-ring inline-flex items-center gap-2 rounded text-[10px] text-[#76cfa8] hover:text-[#91dfbd]"><CalendarClock className="size-3.5" />{formatDateTime(contract.nextVisitAt)}</Link> : <span className="text-[10px] text-[#5f696f]">Не запланирован</span>}</div>
        <div className="mt-4 flex justify-end gap-1.5 lg:mt-0"><button type="button" onClick={() => open(contract, "history")} title="История" className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#737d83] hover:bg-white/[0.04] hover:text-white"><History className="size-3.5" /></button>{canWrite ? <><button type="button" onClick={() => open(contract, "edit")} title="Редактировать" className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#737d83] hover:bg-white/[0.04] hover:text-white"><Pencil className="size-3.5" /></button>{!contract.renewedByContractId && !["draft", "cancelled"].includes(contract.status) ? <button type="button" onClick={() => open(contract, "renew")} title="Продлить" className="focus-ring grid size-9 place-items-center rounded-[10px] border border-[var(--accent)]/18 bg-[var(--accent)]/[0.04] text-[var(--accent)] hover:bg-[var(--accent)]/[0.08]"><RefreshCw className="size-3.5" /></button> : contract.renewedByContractId ? <span title="Продление создано" className="grid size-9 place-items-center text-[#69d3a4]"><ChevronRight className="size-4" /></span> : null}</> : null}</div>
      </article>; })}</div>
      {!visible.length ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><FileSignature className="mx-auto size-8 text-[#515b61]" /><p className="mt-4 text-sm text-[#899298]">Договоры не найдены</p><p className="mt-2 text-xs text-[#5f696f]">Измените условия или сбросьте фильтры.</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-white/[0.07] px-3 py-2 text-xs text-white">Сбросить фильтры</button></div></div> : null}
    </section>

    <Dialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} title="Фильтры договоров" description="Отберите периоды по статусу, сроку действия, графику и ответственному мастеру.">
      <div className="space-y-7 p-5 sm:p-7">
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Статус</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup">{statuses.map((option) => <FilterChoice key={option.value} value={option.value} current={draft.status} label={option.label} onChange={(status) => setDraft((current) => ({ ...current, status }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Плановый график</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><FilterChoice value="all" current={draft.schedule} label="Любой" onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))} /><FilterChoice value="scheduled" current={draft.schedule} label="Есть график" onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))} /><FilterChoice value="unscheduled" current={draft.schedule} label="Без графика" onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))} /></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Срок действия</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><FilterChoice value="all" current={draft.expiry} label="Любой" onChange={(expiry) => setDraft((current) => ({ ...current, expiry }))} /><FilterChoice value="attention" current={draft.expiry} label="Нужно продлить" onChange={(expiry) => setDraft((current) => ({ ...current, expiry }))} /><FilterChoice value="expired" current={draft.expiry} label="Уже истёк" onChange={(expiry) => setDraft((current) => ({ ...current, expiry }))} /></div></fieldset>
        <fieldset><legend className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]"><CalendarRange className="size-3.5" />Дата окончания</legend><div className="grid gap-3 sm:grid-cols-2"><label><span className="mb-2 block text-[10px] text-[#747e84]">С даты</span><input inputMode="numeric" value={draft.dateFrom} onChange={(event) => setDraft((current) => ({ ...current, dateFrom: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label><label><span className="mb-2 block text-[10px] text-[#747e84]">По дату</span><input inputMode="numeric" value={draft.dateTo} onChange={(event) => setDraft((current) => ({ ...current, dateTo: formatDateInput(event.target.value) }))} placeholder="ДД.ММ.ГГГГ" className="h-11 w-full rounded-[12px] border border-white/[0.08] bg-black/10 px-3 text-sm text-white outline-none focus:border-[var(--accent)]/45" /></label></div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Ответственный мастер</legend><div className="max-h-48 space-y-1 overflow-y-auto rounded-[13px] border border-white/[0.07] bg-black/10 p-1.5" role="radiogroup"><FilterChoice value="" current={draft.master} label="Любой мастер" onChange={(master) => setDraft((current) => ({ ...current, master }))} />{masters.map((master) => <FilterChoice key={master} value={master} current={draft.master} label={master} onChange={(selectedMaster) => setDraft((current) => ({ ...current, master: selectedMaster }))} />)}</div></fieldset>
        <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Сортировка</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="expiry-asc" current={draft.sort} label="Сначала истекающие" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><FilterChoice value="expiry-desc" current={draft.sort} label="Сначала дальние" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><FilterChoice value="newest" current={draft.sort} label="Сначала новые периоды" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /><FilterChoice value="oldest" current={draft.sort} label="Сначала старые периоды" onChange={(sort) => setDraft((current) => ({ ...current, sort }))} /></div></fieldset>
        {filterError ? <p role="alert" className="rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.055] p-3 text-xs text-[#dc898e]">{filterError}</p> : null}
      </div>
      <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-white/[0.07] bg-[#0d1317]/95 p-4 backdrop-blur-xl sm:p-5"><button type="button" onClick={() => { setDraft(defaultAdvancedFilters); setFilterError(null); }} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#899399]"><RotateCcw className="mr-2 inline size-3.5" />Очистить</button><button type="button" onClick={applyAdvancedFilters} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#101308]">Показать договоры</button></footer>
    </Dialog>
    <ContractDialogs mode={dialogMode} contract={selected} objectOptions={snapshot.objectOptions} masterOptions={snapshot.masterOptions} onClose={close} />
  </div>;
}
