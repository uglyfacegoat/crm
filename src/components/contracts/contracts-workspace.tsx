"use client";

import { CalendarClock, ChevronRight, Clock3, FileSignature, History, Pencil, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ContractDialogs, NewContractButton, type ContractDialogMode } from "@/components/contracts/contract-dialogs";
import type { ContractListItem, ContractSnapshot, ContractStatus } from "@/server/contracts/types";

const statuses: { value: "all" | ContractStatus; label: string }[] = [
  { value: "all", label: "Все" }, { value: "active", label: "Действуют" }, { value: "draft", label: "Черновики" },
  { value: "suspended", label: "Приостановлены" }, { value: "completed", label: "Завершены" }, { value: "cancelled", label: "Отменены" },
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
  const unit = contract.schedule.frequencyUnit === "month" ? "мес." : "нед.";
  return `Каждые ${contract.schedule.frequencyInterval} ${unit} · ${contract.schedule.localTime}`;
}
function expiryLabel(contract: ContractListItem) {
  if (contract.daysUntilEnd < 0) return `Истёк ${formatDate(contract.endsOn)}`;
  if (contract.daysUntilEnd === 0) return "Истекает сегодня";
  if (contract.daysUntilEnd <= contract.renewalNoticeDays) return `До окончания ${contract.daysUntilEnd} дн.`;
  return `До ${formatDate(contract.endsOn)}`;
}

function SummaryCard({ icon: Icon, label, value, note, tone }: { icon: typeof FileSignature; label: string; value: number; note: string; tone: string }) {
  return <section className="surface-panel min-w-0 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px]" style={{ color: tone, backgroundColor: `${tone}14` }}><Icon className="size-[18px]" /></span><div className="min-w-0"><p className="text-[10px] text-[#768087]">{label}</p><strong className="mt-1 block font-display text-2xl font-semibold tracking-[-0.04em] text-white">{value}</strong><p className="mt-1 truncate text-[9px] text-[#5f696f]">{note}</p></div></div></section>;
}

export function ContractsWorkspace({ snapshot, canWrite }: { snapshot: ContractSnapshot; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ContractStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<ContractDialogMode>(null);
  const selected = snapshot.contracts.find((contract) => contract.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    return snapshot.contracts.filter((contract) => (status === "all" || contract.status === status) && (!normalized || `${contract.contractNumber} ${contract.clientName} ${contract.objectName} ${contract.objectAddress}`.toLocaleLowerCase("ru-RU").includes(normalized)));
  }, [query, snapshot.contracts, status]);
  function open(contract: ContractListItem, mode: Exclude<ContractDialogMode, "create" | null>) { setSelectedId(contract.id); setDialogMode(mode); }
  function close() { setDialogMode(null); setSelectedId(null); }

  return <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] space-y-4">
    <div className="grid gap-3 min-[520px]:grid-cols-2 xl:grid-cols-4"><SummaryCard icon={FileSignature} label="Всего договоров" value={snapshot.summary.total} note="Все сохранённые периоды" tone="#edf43b" /><SummaryCard icon={ShieldCheck} label="Действуют" value={snapshot.summary.active} note="Активное обслуживание" tone="#69d3a4" /><SummaryCard icon={Clock3} label="Требуют продления" value={snapshot.summary.expiring} note="В пределах срока напоминания" tone="#ef8d58" /><SummaryCard icon={CalendarClock} label="Плановых выездов" value={snapshot.summary.scheduledVisits} note="Созданы по договорам" tone="#9c82e8" /></div>

    <section className="surface-panel overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-white/[0.07] p-3 sm:p-4 lg:flex-row lg:items-center">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-white/[0.08] bg-black/10 px-3 lg:max-w-md"><Search className="size-4 shrink-0 text-[#657078]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент, объект или адрес" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#59636a]" /></label>
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{statuses.map((entry) => <button key={entry.value} type="button" onClick={() => setStatus(entry.value)} className={`focus-ring h-11 shrink-0 rounded-[12px] px-3 text-[10px] font-medium ${status === entry.value ? "bg-white/[0.08] text-white" : "text-[#747e84] hover:bg-white/[0.035]"}`}>{entry.label}</button>)}</div>
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
      {!visible.length ? <div className="grid min-h-56 place-items-center p-8 text-center"><div><FileSignature className="mx-auto size-8 text-[#515b61]" /><p className="mt-4 text-sm text-[#899298]">Договоры не найдены</p><p className="mt-2 text-xs text-[#5f696f]">Измените поиск или фильтр статуса.</p></div></div> : null}
    </section>
    <ContractDialogs mode={dialogMode} contract={selected} objectOptions={snapshot.objectOptions} masterOptions={snapshot.masterOptions} onClose={close} />
  </div>;
}
