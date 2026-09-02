"use client";

import { CalendarClock, CheckCircle2, CircleX, History, RefreshCw, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { visitStatusLabels, type ServiceVisit } from "@/server/visits/types";
import type { VisitEventType, VisitHistoryEvent, VisitHistoryFeed } from "@/server/visits/history";

type HistoryFilter = "all" | "schedule" | "cancelled";

const eventAccent: Record<VisitEventType, string> = {
  created: "border-[var(--accent)]/25 bg-[var(--accent)]/[0.07] text-[var(--accent)]",
  schedule_changed: "border-[#62b8ef]/25 bg-[#62b8ef]/[0.07] text-[#82c9f4]",
  status_changed: "border-[#9c82e8]/25 bg-[#9c82e8]/[0.08] text-[#bbaaf1]",
  master_changed: "border-[#e3b75e]/25 bg-[#e3b75e]/[0.07] text-[#e4c270]",
  notes_changed: "border-white/[0.09] bg-white/[0.035] text-[#929ba0]",
};

function formatSchedule(value: string | null, timezone: string) {
  if (!value) return "время не указано";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function eventTitle(event: VisitHistoryEvent) {
  if (event.eventType === "created") return "Выезд создан";
  if (event.eventType === "schedule_changed") return "Дата и время перенесены";
  if (event.eventType === "master_changed") return "Исполнитель изменён";
  if (event.eventType === "notes_changed") return "Заметка обновлена";
  if (event.afterState.status === "cancelled") return "Выезд отменён";
  if (event.afterState.status === "completed") return "Выезд завершён";
  if (event.afterState.status === "in_progress") return "Работы начаты";
  return "Статус выезда изменён";
}

function EventIcon({ event }: { event: VisitHistoryEvent }) {
  if (event.eventType === "created") return <CalendarClock className="size-4" />;
  if (event.eventType === "schedule_changed") return <RefreshCw className="size-4" />;
  if (event.eventType === "master_changed") return <UserRound className="size-4" />;
  if (event.afterState.status === "cancelled") return <CircleX className="size-4" />;
  if (event.afterState.status === "completed") return <CheckCircle2 className="size-4" />;
  return <History className="size-4" />;
}

function EventDetails({ event, timezone }: { event: VisitHistoryEvent; timezone: string }) {
  if (event.eventType === "created") {
    return <p>Назначено на {formatSchedule(event.afterState.scheduledStartAt, timezone)}</p>;
  }
  if (event.eventType === "schedule_changed") {
    return <p><span className="line-through decoration-[#667077]">{formatSchedule(event.beforeState?.scheduledStartAt ?? null, timezone)}</span><span className="mx-2 text-[#586269]">→</span><span className="text-[#dce2df]">{formatSchedule(event.afterState.scheduledStartAt, timezone)}</span></p>;
  }
  if (event.eventType === "status_changed") {
    const before = event.beforeState?.status ? visitStatusLabels[event.beforeState.status] : "Не указан";
    const after = event.afterState.status ? visitStatusLabels[event.afterState.status] : "Не указан";
    return <p>{before}<span className="mx-2 text-[#586269]">→</span><span className="text-[#dce2df]">{after}</span></p>;
  }
  if (event.eventType === "master_changed") return <p>Назначение мастера обновлено сотрудником офиса.</p>;
  return <p>Внутренняя заметка выезда была изменена.</p>;
}

function HistoryTimeline({ feed, visits, filter }: { feed: VisitHistoryFeed; visits: ServiceVisit[]; filter: HistoryFilter }) {
  const visitById = useMemo(() => new Map(visits.map((visit) => [visit.id, visit])), [visits]);
  const events = feed.events.filter((event) => filter === "all" || (filter === "schedule" && event.eventType === "schedule_changed") || (filter === "cancelled" && event.eventType === "status_changed" && event.afterState.status === "cancelled"));

  if (!events.length) {
    return <div className="grid min-h-64 place-items-center px-6 text-center"><div><History className="mx-auto size-7 text-[#525d63]" /><p className="mt-3 text-sm text-[#9aa3a7]">Событий в этой категории нет</p><p className="mt-1 text-xs leading-5 text-[#626c72]">Переносы и изменения статуса появятся здесь автоматически.</p></div></div>;
  }

  return <ol className="divide-y divide-white/[0.055]">{events.map((event) => {
    const visit = visitById.get(event.visitId);
    const timezone = visit?.timezone ?? "Europe/Moscow";
    return <li key={event.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 px-5 py-4 sm:px-7">
      <span className={`grid size-9 place-items-center rounded-[11px] border ${eventAccent[event.eventType]}`}><EventIcon event={event} /></span>
      <div className="min-w-0"><div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div><p className="text-sm font-medium text-[#e3e7e3]">{eventTitle(event)}</p><p className="mt-1 text-[10px] text-[#687279]">{visit ? `${formatSchedule(visit.scheduledStartAt, timezone)} · ${visit.address}` : "Выезд из истории заказа"}</p></div><time dateTime={event.occurredAt} className="shrink-0 text-[10px] text-[#687279]">{new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(event.occurredAt))}</time></div><div className="mt-3 text-xs leading-5 text-[#8f989d]"><EventDetails event={event} timezone={timezone} /></div>{event.reason ? <p className={`mt-2 rounded-[10px] border px-3 py-2 text-xs leading-5 ${event.eventType === "schedule_changed" ? "border-[#62b8ef]/15 bg-[#62b8ef]/[0.045] text-[#93cdea]" : "border-[#ef646a]/15 bg-[#ef646a]/[0.045] text-[#d99a9d]"}`}>{event.eventType === "schedule_changed" ? "Причина переноса" : event.afterState.status === "cancelled" ? "Причина отмены" : "Причина"}: {event.reason}</p> : null}<p className="mt-2 text-[10px] text-[#626c72]">Изменил: {event.actorName}</p></div>
    </li>;
  })}</ol>;
}

export function VisitHistoryButton({ feed, visits }: { feed: VisitHistoryFeed; visits: ServiceVisit[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const scheduleCount = feed.events.filter((event) => event.eventType === "schedule_changed").length;
  const cancellationCount = feed.events.filter((event) => event.eventType === "status_changed" && event.afterState.status === "cancelled").length;

  return <><button type="button" onClick={() => setOpen(true)} className="focus-ring flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-[11px] border border-white/[0.08] px-2 text-xs text-[#aeb6ba] hover:bg-white/[0.035] min-[480px]:flex-none min-[480px]:px-3" aria-label={`Открыть историю выездов, событий: ${feed.totalCount}`}><History className="size-3.5 shrink-0" /><span className="tiny-hidden">История</span>{feed.totalCount ? <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 font-display text-[9px] text-[#858f94]">{feed.totalCount}</span> : null}</button><Dialog open={open} onClose={() => setOpen(false)} title="История выездов" description="Создание, переносы и изменения статуса по всем датам этого заказа."><div className="border-b border-white/[0.06] px-5 py-4 sm:px-7"><div className="grid min-w-0 grid-cols-3 gap-px overflow-hidden rounded-[12px] border border-white/[0.07] bg-white/[0.04]"><button type="button" onClick={() => setFilter("all")} className={`focus-ring min-h-11 min-w-0 px-1 text-[9px] min-[360px]:px-2 min-[360px]:text-[10px] ${filter === "all" ? "bg-[var(--accent)] text-[#111509]" : "bg-[#10171b] text-[#7c868c]"}`}>Все · {feed.totalCount}</button><button type="button" onClick={() => setFilter("schedule")} className={`focus-ring min-h-11 min-w-0 px-1 text-[9px] min-[360px]:px-2 min-[360px]:text-[10px] ${filter === "schedule" ? "bg-[var(--accent)] text-[#111509]" : "bg-[#10171b] text-[#7c868c]"}`}>Переносы · {scheduleCount}</button><button type="button" onClick={() => setFilter("cancelled")} className={`focus-ring min-h-11 min-w-0 px-1 text-[9px] min-[360px]:px-2 min-[360px]:text-[10px] ${filter === "cancelled" ? "bg-[var(--accent)] text-[#111509]" : "bg-[#10171b] text-[#7c868c]"}`}>Отмены · {cancellationCount}</button></div>{feed.hasMore ? <p className="mt-3 text-[10px] leading-4 text-[#d1b86f]">Показаны последние {feed.events.length} из {feed.totalCount} событий.</p> : null}</div><HistoryTimeline feed={feed} visits={visits} filter={filter} /></Dialog></>;
}
