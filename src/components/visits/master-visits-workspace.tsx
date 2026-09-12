"use client";

import { CalendarClock, Check, CircleAlert, Download, ExternalLink, FileCheck2, LoaderCircle, MapPin, Navigation, Play, Route, ShieldCheck } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { startAssignedVisitAction, type StartVisitState } from "@/app/(workspace)/calendar/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { VisitCompletionForm } from "@/components/visits/visit-completion-form";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import type { DocumentTemplateListItem } from "@/server/document-templates/types";
import type { ServiceVisit, VisitStatus } from "@/server/visits/types";

const initialStartState: StartVisitState = { status: "idle", message: null, version: null };
const statusStyles: Record<VisitStatus, string> = {
  planned: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
  confirmed: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
  in_progress: "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-ink)]",
  completed: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
  cancelled: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-ink)]",
};

function localDateKey(visit: ServiceVisit) {
  return dateKey(new Date(visit.scheduledStartAt), visit.timezone);
}

function dateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function formatDay(visit: ServiceVisit) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(visit.scheduledStartAt));
}

function formatTime(visit: ServiceVisit) {
  const formatter = new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, hour: "2-digit", minute: "2-digit" });
  return `${formatter.format(new Date(visit.scheduledStartAt))}–${formatter.format(new Date(visit.scheduledEndAt))}`;
}

function StartVisitButton({ visit }: { visit: ServiceVisit }) {
  const [state, action, pending] = useActionState(startAssignedVisitAction, initialStartState);
  if (visit.statusCode === "in_progress") return <span className="flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-[var(--accent)] bg-[var(--accent-soft)] px-4 text-xs font-semibold text-[var(--accent-ink)]"><Navigation className="size-4" />Работа идёт</span>;
  return <form action={action} className="min-w-0 flex-1 sm:flex-none">
    <input type="hidden" name="visitId" value={visit.id} />
    <input type="hidden" name="expectedVersion" value={visit.version} />
    <button disabled={pending || state.status === "success"} className="focus-ring flex min-h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] disabled:opacity-55">
      {pending ? <LoaderCircle className="size-4 animate-spin" /> : state.status === "success" ? <Check className="size-4" /> : <Play className="size-4" />}
      {pending ? "Сохраняем…" : state.status === "success" ? "Работа начата" : "Начать работу"}
    </button>
    {state.status === "error" ? <p role="alert" className="mt-2 max-w-64 text-[10px] leading-4 text-[var(--danger-ink)]">{state.message}</p> : null}
  </form>;
}

function VisitCard({ visit, onComplete }: { visit: ServiceVisit; onComplete: (visit: ServiceVisit) => void }) {
  const terminal = visit.statusCode === "completed" || visit.statusCode === "cancelled";
  const mapHref = `https://yandex.ru/maps/?text=${encodeURIComponent(visit.address)}`;
  return <article className="overflow-hidden border-y border-l-2 border-[var(--line)] border-l-[var(--accent)] bg-[var(--surface-raised)]">
    <div className="border-b border-[var(--line)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-[14px] border border-[var(--line-strong)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Route className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-display text-base font-semibold text-[var(--text)]">{formatTime(visit)}</p><span className={`rounded-full border px-2.5 py-1 text-[9px] ${statusStyles[visit.statusCode]}`}>{visit.status}</span></div>
          <p className="mt-2 text-sm font-semibold leading-5 text-[var(--text)]">{visit.client}</p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{visit.object}</p>
        </div>
      </div>
      <a href={mapHref} target="_blank" rel="noreferrer" className="focus-ring mt-4 flex min-h-12 items-center gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-left hover:bg-[var(--surface-soft)]">
        <MapPin className="size-4 shrink-0 text-[var(--support-strong)]" /><span className="min-w-0 flex-1 text-xs leading-5 text-[var(--text-secondary)]">{visit.address}</span><ExternalLink className="size-3.5 shrink-0 text-[var(--muted)]" />
      </a>
      {visit.notes ? <div className="mt-3 border-l-2 border-[var(--support-strong)] bg-[var(--surface-inset)] px-3 py-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Комментарий офиса</p><p className="mt-1.5 text-[11px] leading-5 text-[var(--text-secondary)]">{visit.notes}</p></div> : null}
    </div>
    <footer className="flex flex-col gap-2 bg-[var(--surface)] p-3 sm:flex-row sm:items-start sm:p-4">
      <VisitDispatchCardButton visitId={visit.id} className="min-h-11 flex-1 sm:flex-none" />
      {!terminal ? <StartVisitButton visit={visit} /> : null}
      {!terminal ? <button type="button" onClick={() => onComplete(visit)} className="focus-ring flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[12px] border border-[var(--success-border)] bg-[var(--success-bg)] px-4 text-xs font-semibold text-[var(--success)] sm:flex-none"><FileCheck2 className="size-4" />Завершить с актом</button> : null}
      {visit.statusCode === "completed" ? <span className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-[12px] border border-[var(--success-border)] bg-[var(--success-bg)] px-4 text-xs text-[var(--success)]"><ShieldCheck className="size-4" />Акт сохранён</span> : null}
    </footer>
  </article>;
}

export function MasterVisitsWorkspace({ visits, templates, now }: { visits: ServiceVisit[]; templates: DocumentTemplateListItem[]; now: string }) {
  const [completionVisit, setCompletionVisit] = useState<ServiceVisit | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const todayKey = dateKey(new Date(now), visits[0]?.timezone ?? "Europe/Moscow");
  const activeVisits = visits.filter((visit) => visit.statusCode !== "completed" && visit.statusCode !== "cancelled");
  const groups = useMemo(() => {
    const grouped = new Map<string, ServiceVisit[]>();
    for (const visit of visits) {
      const key = localDateKey(visit);
      const existing = grouped.get(key);
      if (existing) existing.push(visit); else grouped.set(key, [visit]);
    }
    return Array.from(grouped.entries());
  }, [visits]);
  const todayCount = visits.filter((visit) => localDateKey(visit) === todayKey && visit.statusCode !== "cancelled").length;
  const completedCount = visits.filter((visit) => visit.statusCode === "completed").length;

  function openCompletion(visit: ServiceVisit) {
    setRequestKey(crypto.randomUUID());
    setCompletionVisit(visit);
  }

  return <>
    <header className="mb-5 sm:mb-7">
      <p className="eyebrow mb-2">Рабочий маршрут</p>
      <h1 className="display-title text-[var(--text)]">Мои выезды</h1>
      <p className="mt-2 max-w-xl text-xs leading-5 text-[var(--muted)]">Только назначенные вам работы. Откройте карточку, начните выезд и приложите подписанный акт после завершения.</p>
    </header>

    <section aria-label="Сводка" className="mb-6 grid grid-cols-3 divide-x divide-[var(--line)] border-y border-[var(--line)]">
      {[
        { label: "Сегодня", value: todayCount, icon: CalendarClock, tone: "text-[var(--accent)]" },
        { label: "В работе", value: activeVisits.length, icon: Navigation, tone: "text-[var(--accent-ink)]" },
        { label: "Закрыто", value: completedCount, icon: FileCheck2, tone: "text-[var(--success)]" },
      ].map((metric) => <div key={metric.label} className="min-w-0 p-3 sm:p-4"><metric.icon className={`size-4 ${metric.tone}`} /><strong className="mt-3 block font-display text-xl text-[var(--text)] sm:text-2xl">{metric.value}</strong><span className="mt-1 block truncate text-[9px] text-[var(--muted)] sm:text-[10px]">{metric.label}</span></div>)}
    </section>

    {templates.length ? <section aria-labelledby="act-templates-title" className="mb-6 border-y border-[var(--line)] py-4 sm:py-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><FileCheck2 className="size-4" /></span><div className="min-w-0 flex-1"><h2 id="act-templates-title" className="text-sm font-semibold text-[var(--text)]">Шаблоны актов</h2><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Скачайте утверждённую форму, заполните и приложите подписанный файл при завершении.</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{templates.map((template) => <a key={template.id} href={`/api/v1/document-templates/${template.id}/download`} className="focus-ring flex min-h-12 min-w-0 items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-raised)] px-3 hover:bg-[var(--surface-soft)]"><Download className="size-4 shrink-0 text-[var(--accent)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--text)]">{template.title}</span><span className="mt-0.5 block truncate text-[9px] text-[var(--muted)]">{template.extension.toUpperCase()} · версия {template.versionNumber}</span></span></a>)}</div></section> : null}

    {groups.length ? <div className="space-y-6">{groups.map(([date, dayVisits]) => <section key={date}>
      <div className="mb-3 flex items-center gap-3"><h2 className="text-sm font-semibold capitalize text-[var(--text)]">{formatDay(dayVisits[0])}</h2><span className="h-px flex-1 bg-[var(--line)]" /><span className="text-[9px] text-[var(--muted)]">{dayVisits.length} выезд.</span></div>
      <div className="grid gap-3 xl:grid-cols-2">{dayVisits.map((visit) => <VisitCard key={visit.id} visit={visit} onComplete={openCompletion} />)}</div>
    </section>)}</div> : <section className="grid min-h-72 place-items-center border-y border-[var(--line)] p-6 text-center"><div className="max-w-sm"><CircleAlert className="mx-auto size-8 text-[var(--muted)]" /><h2 className="mt-4 font-display text-lg font-semibold text-[var(--text)]">Назначенных выездов нет</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Новые работы появятся здесь сразу после назначения диспетчером.</p></div></section>}

    <Dialog open={completionVisit !== null} onClose={() => setCompletionVisit(null)} title="Завершить выезд" description="Подписанный акт обязателен и сохранится в архиве заказа.">
      {completionVisit ? <VisitCompletionForm visit={completionVisit} requestKey={requestKey} onClose={() => setCompletionVisit(null)} /> : null}
    </Dialog>
  </>;
}
