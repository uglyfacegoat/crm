"use client";

import { CalendarClock, Camera, Check, CircleAlert, Download, Eye, ExternalLink, FileCheck2, FileSignature, ImageIcon, LoaderCircle, MapPin, Navigation, Play, Route, ShieldCheck, Upload } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { startAssignedVisitAction, type StartVisitState } from "@/app/(workspace)/calendar/actions";
import { Dialog } from "@/components/ui/dialog";
import { clientCrypto as crypto } from "@/lib/client-id";
import { VisitCompletionForm } from "@/components/visits/visit-completion-form";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { VisitEvidenceForm } from "@/components/visits/visit-evidence-form";
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

function VisitCard({ visit, onComplete, onEvidence, readOnlyPreview }: { visit: ServiceVisit; onComplete: (visit: ServiceVisit) => void; onEvidence: (visit: ServiceVisit) => void; readOnlyPreview: boolean }) {
  const terminal = visit.statusCode === "completed" || visit.statusCode === "cancelled";
  const mapHref = `https://yandex.ru/maps/?text=${encodeURIComponent(visit.address)}`;
  return <article className="min-w-0 overflow-hidden rounded-[20px] border border-[var(--line-strong)] bg-[var(--surface-raised)]">
    <div className="border-b border-[var(--line)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-[14px] border border-[var(--line-strong)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Route className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-display text-base font-semibold text-[var(--text)]">{formatTime(visit)}</p><span className={`rounded-full border px-2.5 py-1 text-[9px] ${statusStyles[visit.statusCode]}`}>{visit.status}</span></div>
          <p className="mt-2 break-words text-sm font-semibold leading-5 text-[var(--text)]">{visit.client}</p>
          <p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]">{visit.object}</p>
        </div>
      </div>
      <a href={mapHref} target="_blank" rel="noreferrer" className="focus-ring mt-4 flex min-h-12 items-center gap-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 text-left hover:bg-[var(--surface-soft)]">
        <MapPin className="size-4 shrink-0 text-[var(--support-strong)]" /><span className="min-w-0 flex-1 break-words text-xs leading-5 text-[var(--text-secondary)]">{visit.address}</span><ExternalLink className="size-3.5 shrink-0 text-[var(--muted)]" />
      </a>
      {visit.notes ? <div className="mt-3 rounded-[13px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2.5"><p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-[var(--muted)]">Комментарий офиса</p><p className="mt-1.5 break-words text-[11px] leading-5 text-[var(--text-secondary)]">{visit.notes}</p></div> : null}
    </div>
    <footer className="grid min-w-0 grid-cols-2 gap-2 bg-[var(--surface)] p-3 sm:p-4">
      <VisitDispatchCardButton visitId={visit.id} label="Задание" className="h-11 min-w-0 w-full px-2" />
      {visit.statusCode !== "cancelled" ? <button type="button" onClick={() => onEvidence(visit)} className="focus-ring flex h-11 min-w-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-2 text-xs font-semibold text-[var(--text-secondary)]"><Camera className="size-4 shrink-0" /><span className="truncate">Материалы</span></button> : null}
      {!terminal ? readOnlyPreview ? <span className="flex h-11 min-w-0 items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-2 text-xs font-semibold text-[var(--on-accent)] opacity-55"><Play className="size-4 shrink-0" /><span className="truncate">Начать</span></span> : <StartVisitButton visit={visit} /> : null}
      {!terminal ? <button type="button" onClick={() => onComplete(visit)} className="focus-ring flex h-11 min-w-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--success-border)] bg-[var(--success-bg)] px-2 text-xs font-semibold text-[var(--success)]"><FileCheck2 className="size-4 shrink-0" /><span className="truncate">Завершить</span></button> : null}
      {visit.statusCode === "completed" ? <span className="col-span-2 flex h-11 min-w-0 items-center justify-center gap-2 rounded-[12px] border border-[var(--success-border)] bg-[var(--success-bg)] px-3 text-xs text-[var(--success)]"><ShieldCheck className="size-4" />Акт сохранён</span> : null}
    </footer>
  </article>;
}

function PreviewEvidencePanel({ visit, onClose }: { visit: ServiceVisit; onClose: () => void }) {
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
      <section className="rounded-[16px] border border-[var(--line)] bg-[var(--surface-inset)] p-4"><p className="text-sm font-semibold text-[var(--text)]">{visit.client}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{visit.object} · заказ №{visit.orderNumber}</p></section>
      <fieldset><legend className="text-[10px] text-[var(--text-secondary)]">Что загружаете</legend><div className="mt-2 grid grid-cols-2 gap-2"><span className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border border-[var(--accent)] bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent-ink)]"><ImageIcon className="size-4" />Фото работы</span><span className="flex min-h-12 items-center justify-center gap-2 rounded-[13px] border border-[var(--line)] bg-[var(--surface-raised)] text-xs text-[var(--text-secondary)]"><FileSignature className="size-4" />Фото договора</span></div></fieldset>
      <div className="flex min-h-36 flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-4 py-6 text-center"><Upload className="size-7 text-[var(--muted)]" /><span className="mt-3 text-xs text-[var(--text)]">Снять фото или выбрать файл</span><span className="mt-1 text-[9px] text-[var(--muted)]">В режиме разработчика загрузка отключена</span></div>
      <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]">Комментарий<textarea disabled rows={4} placeholder="Что видно на фото или к какой части работ оно относится" className="resize-none rounded-[14px] border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-xs leading-5 text-[var(--text)] outline-none placeholder:text-[var(--muted-subtle)]" /></label>
    </div>
    <footer className="flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7"><button type="button" onClick={onClose} className="focus-ring h-11 flex-1 rounded-[12px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)]">Закрыть</button><button type="button" disabled className="inline-flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] opacity-45"><Camera className="size-4" />Добавить материал</button></footer>
  </div>;
}

function PreviewCompletionPanel({ visit, onClose }: { visit: ServiceVisit; onClose: () => void }) {
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
      <section className="rounded-[16px] border border-[var(--line)] bg-[var(--accent-soft)] p-4"><p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">Контроль закрытия</p><h3 className="mt-2 text-sm font-semibold text-[var(--text)]">{visit.client}</h3><p className="mt-1 text-xs text-[var(--text-secondary)]">{visit.object}</p></section>
      <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]">Название акта<input disabled value={`Акт выполненных работ · ${visit.orderNumber ?? "выезд"}`} readOnly className="h-12 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-4 text-sm text-[var(--text)]" /></label>
      <label className="grid gap-2 text-[10px] text-[var(--text-secondary)]">Результат работ<textarea disabled rows={4} placeholder="Что выполнено, результат осмотра, рекомендации клиенту…" className="resize-none rounded-[14px] border border-[var(--line)] bg-[var(--surface-inset)] p-3 text-xs leading-5 text-[var(--text)] placeholder:text-[var(--muted-subtle)]" /></label>
      <div className="flex min-h-28 flex-col items-center justify-center rounded-[15px] border border-dashed border-[var(--line-strong)] bg-[var(--surface-inset)] px-4 py-5 text-center"><Upload className="size-6 text-[var(--muted)]" /><span className="mt-2 text-xs text-[var(--text-secondary)]">Выбрать акт или фотографию</span><span className="mt-1 text-[9px] text-[var(--muted)]">В режиме разработчика сохранение отключено</span></div>
    </div>
    <footer className="flex shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:px-7"><button type="button" onClick={onClose} className="focus-ring h-11 flex-1 rounded-[12px] border border-[var(--line-strong)] text-xs text-[var(--text-secondary)]">Закрыть</button><button type="button" disabled className="flex h-11 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--on-accent)] opacity-45"><FileCheck2 className="size-4" />Завершить с актом</button></footer>
  </div>;
}

export function MasterVisitsWorkspace({ visits, templates, now, readOnlyPreview = false }: { visits: ServiceVisit[]; templates: DocumentTemplateListItem[]; now: string; readOnlyPreview?: boolean }) {
  const [completionVisit, setCompletionVisit] = useState<ServiceVisit | null>(null);
  const [evidenceVisit, setEvidenceVisit] = useState<ServiceVisit | null>(null);
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

    {readOnlyPreview ? <section className="mb-5 flex items-start gap-3 rounded-[15px] border border-[var(--info-border)] bg-[var(--info-bg)] p-4"><Eye className="mt-0.5 size-4 shrink-0 text-[var(--info)]" /><div><p className="text-xs font-semibold text-[var(--text)]">Предпросмотр разработчика</p><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Показаны реальные данные рабочего контура. Действия открываются для проверки интерфейса, но ничего не меняют.</p></div></section> : null}

    <section aria-label="Сводка" className="mb-6 grid grid-cols-3 gap-2">
      {[
        { label: "Сегодня", value: todayCount, icon: CalendarClock, tone: "text-[var(--accent)]" },
        { label: "В работе", value: activeVisits.length, icon: Navigation, tone: "text-[var(--accent-ink)]" },
        { label: "Закрыто", value: completedCount, icon: FileCheck2, tone: "text-[var(--success)]" },
      ].map((metric) => <div key={metric.label} className="min-w-0 rounded-[15px] border border-[var(--line)] bg-[var(--surface-raised)] p-3 sm:p-4"><metric.icon className={`size-4 ${metric.tone}`} /><strong className="mt-3 block font-display text-xl text-[var(--text)] sm:text-2xl">{metric.value}</strong><span className="mt-1 block truncate text-[9px] text-[var(--muted)] sm:text-[10px]">{metric.label}</span></div>)}
    </section>

    {templates.length ? <section aria-labelledby="act-templates-title" className="mb-6 rounded-[18px] border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-[var(--accent-soft)] text-[var(--accent-ink)]"><FileCheck2 className="size-4" /></span><div className="min-w-0 flex-1"><h2 id="act-templates-title" className="text-sm font-semibold text-[var(--text)]">Шаблоны актов</h2><p className="mt-1 text-[10px] leading-4 text-[var(--muted)]">Скачайте утверждённую форму, заполните и приложите подписанный файл при завершении.</p></div></div><div className={`mt-4 grid gap-2 ${readOnlyPreview ? "" : "sm:grid-cols-2 xl:grid-cols-3"}`}>{templates.map((template) => <a key={template.id} href={`/api/v1/document-templates/${template.id}/download`} className="focus-ring flex min-h-12 min-w-0 items-center gap-3 rounded-[12px] border border-[var(--line)] bg-[var(--surface-inset)] px-3 hover:bg-[var(--surface-soft)]"><Download className="size-4 shrink-0 text-[var(--accent)]" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-[var(--text)]">{template.title}</span><span className="mt-0.5 block truncate text-[9px] text-[var(--muted)]">{template.extension.toUpperCase()} · версия {template.versionNumber}</span></span></a>)}</div></section> : null}

    {groups.length ? <div className="space-y-6">{groups.map(([date, dayVisits]) => <section key={date}>
      <div className="mb-3 flex items-center gap-3"><h2 className="text-sm font-semibold capitalize text-[var(--text)]">{formatDay(dayVisits[0])}</h2><span className="h-px flex-1 bg-[var(--line)]" /><span className="text-[9px] text-[var(--muted)]">{dayVisits.length} выезд.</span></div>
      <div className={`grid gap-3 ${readOnlyPreview ? "" : "xl:grid-cols-2"}`}>{dayVisits.map((visit) => <VisitCard key={visit.id} visit={visit} onComplete={openCompletion} onEvidence={setEvidenceVisit} readOnlyPreview={readOnlyPreview} />)}</div>
    </section>)}</div> : <section className="grid min-h-72 place-items-center rounded-[20px] border border-[var(--line)] bg-[var(--surface-raised)] p-6 text-center"><div className="max-w-sm"><CircleAlert className="mx-auto size-8 text-[var(--muted)]" /><h2 className="mt-4 font-display text-lg font-semibold text-[var(--text)]">Назначенных выездов нет</h2><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Новые работы появятся здесь сразу после назначения диспетчером.</p></div></section>}

    <Dialog open={completionVisit !== null} onClose={() => setCompletionVisit(null)} title="Завершить выезд" description="Подписанный акт обязателен и сохранится в архиве заказа.">
      {completionVisit ? readOnlyPreview ? <PreviewCompletionPanel visit={completionVisit} onClose={() => setCompletionVisit(null)} /> : <VisitCompletionForm visit={completionVisit} requestKey={requestKey} onClose={() => setCompletionVisit(null)} /> : null}
    </Dialog>
    <Dialog open={evidenceVisit !== null} onClose={() => setEvidenceVisit(null)} title="Материалы выезда" description="Фотографии работы и договора сохраняются в архиве заказа и доступны офису.">
      {evidenceVisit ? readOnlyPreview ? <PreviewEvidencePanel visit={evidenceVisit} onClose={() => setEvidenceVisit(null)} /> : <VisitEvidenceForm visit={evidenceVisit} onClose={() => setEvidenceVisit(null)} /> : null}
    </Dialog>
  </>;
}
