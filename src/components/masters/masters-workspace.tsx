"use client";

import { Grid2X2, List, MapPin, MessageCircle, Phone, Search, UsersRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatMoneyMinor, getInitials } from "@/lib/format";
import type { MasterListItem, MasterStatusCode } from "@/server/masters/types";

const statusStyle: Record<MasterStatusCode, string> = {
  scheduled: "border-[#dce63c]/20 bg-[#dce63c]/10 text-[#dfe874]",
  available: "border-[#58a6ff]/20 bg-[#58a6ff]/10 text-[#7fb9f4]",
  overloaded: "border-[#f07832]/20 bg-[#f07832]/10 text-[#f2945d]",
  inactive: "border-white/[0.08] bg-white/[0.04] text-[#7a858b]",
};

const statusFilters: Array<{ value: "all" | MasterStatusCode; label: string }> = [
  { value: "all", label: "Все" }, { value: "scheduled", label: "С выездами" },
  { value: "available", label: "Свободны" }, { value: "overloaded", label: "Перегружены" },
  { value: "inactive", label: "Неактивны" },
];

function FilterMenu({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <details className="group relative shrink-0"><summary className="focus-ring flex h-10 min-w-32 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-white/[0.07] px-3 text-xs text-[#8a949a] [&::-webkit-details-marker]:hidden"><span className="max-w-36 truncate">{value || label}</span><span className="text-[9px] text-[#59636a]">▼</span></summary><div className="absolute right-0 top-12 z-30 min-w-48 rounded-xl border border-white/[0.09] bg-[#11181c] p-1.5 shadow-2xl">{["", ...options].map((option) => <button key={option || "all"} type="button" onClick={(event) => { onChange(option); event.currentTarget.closest("details")?.removeAttribute("open"); }} className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${value === option ? "bg-[var(--accent)]/[0.09] text-[var(--accent)]" : "text-[#8d979c] hover:bg-white/[0.04] hover:text-white"}`}>{option || `Все: ${label.toLocaleLowerCase("ru")}`}</button>)}</div></details>;
}

function visitTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(iso));
}

export function MastersWorkspace({ masters }: { masters: MasterListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | MasterStatusCode>("all");
  const [region, setRegion] = useState("");
  const [zone, setZone] = useState("");
  const [skill, setSkill] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");

  const facets = useMemo(() => ({
    regions: Array.from(new Set(masters.map((master) => master.serviceRegion))).sort((a, b) => a.localeCompare(b, "ru")),
    zones: Array.from(new Set(masters.filter((master) => !region || master.serviceRegion === region).map((master) => master.serviceZone))).sort((a, b) => a.localeCompare(b, "ru")),
    skills: Array.from(new Set(masters.flatMap((master) => master.skills))).sort((a, b) => a.localeCompare(b, "ru")),
  }), [masters, region]);
  const counts = useMemo(() => new Map(statusFilters.map((entry) => [entry.value, entry.value === "all" ? masters.length : masters.filter((master) => master.statusCode === entry.value).length])), [masters]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    return masters.filter((master) => {
      if (status !== "all" && master.statusCode !== status) return false;
      if (region && master.serviceRegion !== region) return false;
      if (zone && master.serviceZone !== zone) return false;
      if (skill && !master.skills.includes(skill)) return false;
      if (!normalizedQuery) return true;
      return [master.fullName, master.phone, master.messenger, master.serviceRegion, master.serviceZone, ...master.skills].filter((field): field is string => Boolean(field)).some((field) => field.toLocaleLowerCase("ru").includes(normalizedQuery));
    });
  }, [masters, query, region, skill, status, zone]);

  return <div className="mt-[clamp(1.2rem,0.9rem+0.7vw,2rem)]">
    <div className="flex flex-col gap-3"><div className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.07] p-1">{statusFilters.map((entry) => <button key={entry.value} type="button" onClick={() => setStatus(entry.value)} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs ${status === entry.value ? "bg-[var(--accent)]/[0.09] text-[var(--accent)]" : "text-[#858f95]"}`}>{entry.label}<span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px]">{counts.get(entry.value)}</span></button>)}</div><div className="flex min-w-0 flex-wrap gap-2"><label className="soft-button flex h-10 min-w-52 flex-1 items-center gap-2 rounded-xl px-3"><Search className="size-4 text-[#687279]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ФИО, телефон, регион, зона…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#59636a]" /></label><FilterMenu label="Регион" value={region} options={facets.regions} onChange={(value) => { setRegion(value); setZone(""); }} /><FilterMenu label="Зона" value={zone} options={facets.zones} onChange={setZone} /><FilterMenu label="Специализация" value={skill} options={facets.skills} onChange={setSkill} /><div className="flex rounded-xl border border-white/[0.07] p-1"><button type="button" aria-label="Показать карточками" onClick={() => setView("grid")} className={`grid size-8 place-items-center rounded-lg ${view === "grid" ? "bg-[var(--accent)] text-[#101308]" : "text-[#707a80]"}`}><Grid2X2 className="size-4" /></button><button type="button" aria-label="Показать списком" onClick={() => setView("list")} className={`grid size-8 place-items-center rounded-lg ${view === "list" ? "bg-[var(--accent)] text-[#101308]" : "text-[#707a80]"}`}><List className="size-4" /></button></div></div></div>

    <section className={`mt-4 grid gap-3 ${view === "grid" ? "sm:grid-cols-2 2xl:grid-cols-3 min-[2200px]:grid-cols-4" : "grid-cols-1"}`}>{filtered.map((master, index) => <article key={master.id} role="link" tabIndex={0} aria-label={`Открыть карточку мастера ${master.fullName}`} onClick={(event) => { if (!(event.target as HTMLElement).closest("a,button")) router.push(`/masters/${master.id}`); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(`/masters/${master.id}`); } }} className={`surface-panel min-w-0 cursor-pointer p-4 transition-colors hover:border-[#9c82e8]/20 hover:bg-[#9c82e8]/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9c82e8] ${view === "list" ? "lg:grid lg:grid-cols-[minmax(15rem,1.2fr)_minmax(10rem,0.8fr)_minmax(14rem,1fr)_11rem] lg:items-center lg:gap-5" : ""}`}>
      <div><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.055] font-display text-xs text-white">{getInitials(master.fullName)}</span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-white">{master.fullName}</h2><p className="mt-1 flex items-center gap-1 truncate text-[10px] text-[#747e84]"><MapPin className="size-3" />{master.serviceRegion} · {master.serviceZone}</p></div><span className={`rounded-lg border px-2 py-1 text-[9px] ${statusStyle[master.statusCode]}`}>{master.statusLabel}</span></div><div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-[#8b959b]"><a href={`tel:${master.phone}`} className="flex items-center gap-1.5 hover:text-white"><Phone className="size-3" />{master.phone}</a>{master.messenger ? <span className="flex items-center gap-1.5"><MessageCircle className="size-3" />{master.messenger}</span> : null}</div>{master.skills.length ? <div className="mt-3 flex flex-wrap gap-1.5">{master.skills.slice(0, 4).map((entry) => <span key={entry} className="rounded-md bg-white/[0.045] px-2 py-1 text-[9px] text-[#7e888e]">{entry}</span>)}</div> : null}</div>
      <div className={view === "list" ? "mt-4 lg:mt-0" : "mt-5"}><div className="flex justify-between text-[10px]"><span className="text-[#747e84]">Загрузка сегодня</span><strong className="font-display text-white">{master.loadPercent}% · {master.todayVisitCount}/{master.dailyCapacity}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.055]"><div className={`h-full rounded-full ${master.loadPercent > 100 ? "bg-[#f07832]" : ["bg-[var(--accent)]", "bg-[#9c82e8]", "bg-[#55d5ca]", "bg-[#58a6ff]"][index % 4]}`} style={{ width: `${Math.min(master.loadPercent, 100)}%` }} /></div></div>
      <div className={`${view === "list" ? "mt-4 lg:mt-0" : "mt-5 min-h-24"}`}><p className="mb-2 text-[9px] uppercase tracking-[0.12em] text-[#626c72]">Сегодня</p>{master.todayVisits.length ? master.todayVisits.slice(0, view === "list" ? 2 : 4).map((visit) => <Link key={visit.id} href={`/orders/${visit.orderId}`} className="mb-2 block truncate text-[10px] text-[#9ba4a8] hover:text-white">{visitTime(visit.scheduledStartAt, visit.timezone)} · №{visit.orderNumber} · {visit.clientName}</Link>) : <p className="text-[10px] text-[#626c72]">Выездов нет</p>}</div>
      <div className={`${view === "list" ? "mt-4 border-0 pt-0 text-right lg:mt-0" : "mt-4 border-t border-white/[0.06] pt-4"}`}><p className="text-[9px] text-[#6e787e]">Базовая выпла</p><strong className="mt-1 block font-display text-xs text-white">{master.basePaymentMinor === undefined ? "Скрыто правами" : master.basePaymentMinor === null ? "Не указана" : formatMoneyMinor(master.basePaymentMinor)}</strong></div>
    </article>)}</section>
    {filtered.length === 0 ? <div className="surface-panel mt-4 grid min-h-48 place-items-center text-center"><div><UsersRound className="mx-auto size-8 text-[#4f595f]" /><p className="mt-3 text-sm text-[#7e888e]">Мастера не найдены</p><p className="mt-1 text-[10px] text-[#5e686e]">Измените поиск или фильтры.</p></div></div> : null}
  </div>;
}
