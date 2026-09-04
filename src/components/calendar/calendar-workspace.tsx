"use client";

import { DateInput, TimeInput } from "@/components/ui/date-time-inputs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, GripVertical, ListPlus, LoaderCircle, Move, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { createVisitAction, rescheduleVisitAction } from "@/app/(workspace)/calendar/actions";
import { OrderPicker } from "@/components/orders/order-form-parts";
import { Dialog } from "@/components/ui/dialog";
import { VisitDispatchCardButton } from "@/components/visits/visit-dispatch-card";
import { clientCrypto as crypto } from "@/lib/client-id";
import { filterCalendarVisits } from "@/lib/visits/calendar-filters";
import { layoutCalendarIntervals } from "@/lib/visits/calendar-layout";
import type { OrderListItem } from "@/server/orders/types";
import { visitStatusLabels, type ServiceVisit } from "@/server/visits/types";

type CalendarView = "day" | "week" | "month" | "list";
type CalendarDay = { date: string; weekday: string; day: number };
type CalendarEntry = {
  visit: ServiceVisit;
  time: string;
  startMinute: number;
  endMinute: number;
};
type MoveVisitDraft = { visit: ServiceVisit; localDate: string; localTime: string };

const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_HEIGHT = 66;
const GRID_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT;
const SNAP_MINUTES = 15;
const terminalStatuses = new Set<ServiceVisit["statusCode"]>(["completed", "cancelled"]);

const eventColors: Record<ServiceVisit["statusCode"], string> = {
  planned: "border-[#91e9ce]/35 bg-[#66701c]/95 text-[#b8f7e4] shadow-[0_10px_32px_rgba(170,184,32,0.12)]",
  confirmed: "border-[#91e9ce]/35 bg-[#17635f]/95 text-[#9ce8e0] shadow-[0_10px_32px_rgba(44,181,171,0.12)]",
  in_progress: "border-[#b8f7e4]/35 bg-[#25272c]/95 text-[#b8f7e4] shadow-[0_10px_32px_rgba(117,89,194,0.13)]",
  completed: "border-[#b8f7e4]/30 bg-[#245f49]/90 text-[#9ee7c5]",
  cancelled: "border-[#ef646a]/25 bg-[#642d32]/80 text-[#f09ba0] opacity-70",
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + amount);
  return next;
}

function startOfWeek(anchorDate: string) {
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  return addDays(anchor, 1 - weekday);
}

function calendarDay(date: Date): CalendarDay {
  return {
    date: isoDate(date),
    weekday: new Intl.DateTimeFormat("ru-RU", { weekday: "short", timeZone: "UTC" }).format(date),
    day: date.getUTCDate(),
  };
}

function startOfMonthGrid(anchorDate: string) {
  const anchor = new Date(`${anchorDate.slice(0, 7)}-01T12:00:00Z`);
  return startOfWeek(isoDate(anchor));
}

function addMonths(date: Date, amount: number) {
  const next = new Date(date);
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + amount);
  return next;
}

function zonedParts(timestamp: string, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
}

function localVisitEntry(visit: ServiceVisit): CalendarEntry & { date: string } {
  const start = zonedParts(visit.scheduledStartAt, visit.timezone);
  const end = zonedParts(visit.scheduledEndAt, visit.timezone);
  const date = `${start.year}-${start.month}-${start.day}`;
  const endDate = `${end.year}-${end.month}-${end.day}`;
  const startMinute = Number(start.hour) * 60 + Number(start.minute);
  const endMinute = endDate === date ? Number(end.hour) * 60 + Number(end.minute) : 24 * 60;
  return { visit, date, time: `${start.hour}:${start.minute}`, startMinute, endMinute: Math.max(startMinute + 1, endMinute) };
}

function weekLabel(firstDay: Date, lastDay: Date) {
  const formatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  return `${formatter.format(firstDay)} — ${formatter.format(lastDay)}`;
}

function formatTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatVisitListDate(visit: ServiceVisit) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: visit.timezone, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(visit.scheduledStartAt));
}

function MoveVisitDialog({ draft, pending, error, onClose, onMove }: {
  draft: MoveVisitDraft | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onMove: (visit: ServiceVisit, localDate: string, localTime: string, rescheduleReason: string) => void;
}) {
  if (!draft) return null;
  const { visit } = draft;
  return <Dialog open onClose={onClose} title="Перенести выезд" description="Длительность, мастер, статус и связь с заказом сохранятся.">
    <form onSubmit={(event) => { event.preventDefault(); const formData = new FormData(event.currentTarget); onMove(visit, String(formData.get("localDate")), String(formData.get("localTime")), String(formData.get("rescheduleReason"))); }} className="flex flex-1 flex-col">
      <div className="flex-1 space-y-6 p-5 sm:p-7">
        <div className={`rounded-[14px] border p-4 ${eventColors[visit.statusCode]}`}><p className="text-[10px] font-semibold uppercase tracking-[0.12em] opacity-75">{visit.orderNumber ?? "Без номера"}</p><p className="mt-2 text-sm font-semibold text-white">{visit.client}</p><p className="mt-1 text-xs opacity-75">{visit.address}</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-[10px] text-[#778187]"><span>Новая дата</span><DateInput required name="localDate" defaultValue={draft.localDate} className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white [color-scheme:dark]" /></label><label className="grid gap-2 text-[10px] text-[#778187]"><span>Новое время</span><TimeInput required step={SNAP_MINUTES * 60} name="localTime" defaultValue={draft.localTime} className="focus-ring h-12 rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 text-sm text-white [color-scheme:dark]" /></label></div>
        <label className="grid gap-2 text-[10px] text-[#778187]"><span>Причина переноса <b className="text-[var(--accent)]">*</b></span><textarea required minLength={3} maxLength={1000} name="rescheduleReason" placeholder="Например: клиент попросил перенести выезд" className="focus-ring min-h-28 resize-y rounded-[12px] border border-white/[0.08] bg-black/15 px-3.5 py-3 text-sm leading-5 text-white placeholder:text-[#4f595f]" /><span className="text-[9px] leading-4 text-[#626c72]">Причина сохранится отдельно от заметок и будет видна в истории заказа.</span></label>
        <p className="rounded-[12px] border border-white/[0.06] bg-white/[0.025] p-3 text-[10px] leading-5 text-[#717b81]">При переносе автоматически изменится задача-напоминание. Если мастер занят, система не сохранит конфликтующее время.</p>
        {error ? <p role="alert" className="rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.05] p-3 text-xs text-[#dc969a]">{error}</p> : null}
      </div>
      <footer className="sticky bottom-0 flex gap-2 border-t border-white/[0.07] bg-[#25272c]/94 p-4 backdrop-blur-xl sm:px-7"><button type="button" onClick={onClose} disabled={pending} className="focus-ring h-12 flex-1 rounded-[12px] border border-white/[0.08] text-xs text-[#8b959b]">Отмена</button><button type="submit" disabled={pending} className="focus-ring flex h-12 flex-[1.4] items-center justify-center gap-2 rounded-[12px] bg-[var(--accent)] text-xs font-semibold text-[#25272c] disabled:opacity-60">{pending ? <><LoaderCircle className="size-4 animate-spin" />Переносим…</> : <><Move className="size-4" />Перенести</>}</button></footer>
    </form>
  </Dialog>;
}

function CalendarList({ visits, canWrite, onOpenMove }: { visits: ServiceVisit[]; canWrite: boolean; onOpenMove: (visit: ServiceVisit) => void }) {
  const orderedVisits = useMemo(() => visits.toSorted((left, right) => left.scheduledStartAt.localeCompare(right.scheduledStartAt)), [visits]);
  return <section className="surface-panel mt-3 overflow-hidden"><header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[0.06] px-4 py-4 sm:px-6"><div><h2 className="text-sm font-semibold text-white">Расписание всех заказов</h2><p className="mt-1 text-xs text-[#707a80]">Каждый выезд хранится отдельно и ведёт в свою карточку заказа.</p></div><span className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[10px] text-[#8c969b]">{orderedVisits.length} выезд.</span></header>{orderedVisits.length ? <div className="divide-y divide-white/[0.055]">{orderedVisits.map((visit) => <article key={visit.id} className="grid gap-3 px-4 py-4 hover:bg-white/[0.025] sm:px-6 md:grid-cols-[10rem_7rem_minmax(0,1fr)_10rem_auto_auto] md:items-center"><div><p className="font-display text-xs text-white">{formatVisitListDate(visit)}</p><p className="mt-1 text-[9px] text-[#657078]">{visit.timezone}</p></div><strong className="font-display text-[11px] text-[var(--accent)]">{visit.orderNumber ?? "Без заказа"}</strong><Link href={visit.orderId ? `/orders/${visit.orderId}` : "/calendar"} className="focus-ring min-w-0 rounded"><p className="truncate text-xs font-medium text-[#d8ddda]">{visit.client} · {visit.object}</p><p className="mt-1 truncate text-[10px] text-[#69737a]">{visit.address}</p></Link><p className="truncate text-[10px] text-[#8b959a]">{visit.master ?? "Мастер не назначен"}</p><span className={`w-fit rounded-full border px-2.5 py-1 text-[9px] ${eventColors[visit.statusCode]}`}>{visit.status}</span><div className="flex items-center gap-2"><VisitDispatchCardButton visitId={visit.id} compact />{canWrite && !terminalStatuses.has(visit.statusCode) ? <button type="button" onClick={() => onOpenMove(visit)} aria-label={`Перенести выезд ${visit.orderNumber ?? visit.client}`} className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#7b858b] hover:text-white"><Move className="size-4" /></button> : null}</div></article>)}</div> : <div className="grid min-h-64 place-items-center text-center"><div><CalendarDays className="mx-auto size-8 text-[#4d575d]" /><p className="mt-3 text-xs text-[#707a80]">В выбранном периоде выездов нет</p></div></div>}</section>;
}

function UnassignedOrdersPanel({ orders, canWrite, pendingId, onClose, onDragStart, onDragEnd }: {
  orders: OrderListItem[];
  canWrite: boolean;
  pendingId: string | null;
  onClose: () => void;
  onDragStart: (order: OrderListItem, event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  return <aside className="surface-panel min-w-0 p-3 sm:p-4"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold text-white">Без даты / нужно назначить</h2><p className="mt-1 text-[10px] text-[#667078]">{orders.length} заказ. · перетащите в расписание</p></div><button type="button" onClick={onClose} aria-label="Скрыть неназначенные заказы" className="focus-ring grid size-9 place-items-center rounded-[10px] border border-white/[0.07] text-[#778187]"><ChevronRight className="size-4" /></button></div><div className="mt-3 max-h-[calc(100dvh-20rem)] space-y-2 overflow-y-auto">{orders.length ? orders.map((order) => <article key={order.id} draggable={canWrite && pendingId !== order.id} onDragStart={(event) => onDragStart(order, event)} onDragEnd={onDragEnd} className={`group rounded-[12px] border border-white/[0.07] bg-white/[0.025] p-3 hover:border-[var(--accent)]/20 hover:bg-[var(--accent)]/[0.035] ${canWrite ? "cursor-grab active:cursor-grabbing" : ""} ${pendingId === order.id ? "opacity-45" : ""}`}><div className="flex items-center justify-between gap-3"><strong className="font-display text-[10px] text-[var(--accent)]">{order.number}</strong><span className="flex items-center gap-1 text-[9px] text-[#687279]"><GripVertical className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />{order.status}</span></div><Link href={`/orders/${order.id}?newVisit=1`} className="focus-ring mt-2 block rounded"><p className="truncate text-xs font-medium text-white">{order.client}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#707a80]">{order.object} · {order.address}</p></Link></article>) : <div className="grid min-h-48 place-items-center text-center"><div><Check className="mx-auto size-7 text-[var(--success)]" /><p className="mt-3 text-xs text-[#899399]">Все активные заказы уже в расписании</p></div></div>}</div></aside>;
}

function ScheduleGrid({ days, visitsByDate, selectedDate, view, canWrite, draggingId, pendingId, dropTarget, onSelectDay, onDragStart, onDragEnd, onDragOverDay, onDropDay, onOpenMove }: {
  days: CalendarDay[];
  visitsByDate: Map<string, CalendarEntry[]>;
  selectedDate: string;
  view: "day" | "week";
  canWrite: boolean;
  draggingId: string | null;
  pendingId: string | null;
  dropTarget: { date: string; minute: number } | null;
  onSelectDay: (date: string) => void;
  onDragStart: (visit: ServiceVisit, event: React.DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOverDay: (date: string, event: React.DragEvent<HTMLElement>) => void;
  onDropDay: (date: string, event: React.DragEvent<HTMLElement>) => void;
  onOpenMove: (visit: ServiceVisit) => void;
}) {
  return <section className="surface-panel min-w-0 overflow-hidden"><div className="divide-y divide-white/[0.055] lg:hidden">{days.map((day) => <div key={day.date}><button onClick={() => onSelectDay(day.date)} className="flex w-full items-center justify-between bg-white/[0.018] px-4 py-3 text-left"><span className="text-xs capitalize text-white">{day.weekday}, {day.day}</span><span className="text-[10px] text-[var(--accent)]">{visitsByDate.get(day.date)?.length ?? 0} выезд.</span></button>{(visitsByDate.get(day.date) ?? []).map(({ visit, time }) => <article key={visit.id} className={`m-3 rounded-xl border p-3 ${eventColors[visit.statusCode]}`}><div className="flex items-start gap-3"><Link href={visit.orderId ? `/orders/${visit.orderId}` : "/calendar"} className="focus-ring min-w-0 flex-1 rounded"><p className="font-display text-xs">{time}</p><p className="mt-2 truncate text-sm font-semibold text-white">{visit.client}</p><p className="mt-1 truncate text-xs text-[#a5ada9]">{visit.address} · {visit.master ?? "не назначен"}</p></Link><div className="flex shrink-0 gap-2"><VisitDispatchCardButton visitId={visit.id} compact className="size-10" />{canWrite && !terminalStatuses.has(visit.statusCode) ? <button type="button" onClick={() => onOpenMove(visit)} aria-label={`Перенести выезд ${visit.orderNumber ?? visit.client}`} className="focus-ring grid size-10 shrink-0 place-items-center rounded-[11px] border border-white/[0.1] bg-black/10"><Move className="size-4" /></button> : null}</div></div></article>)}</div>)}</div>
    <div className="hidden min-w-[860px] lg:block"><div className={`grid border-b border-white/[0.06] ${view === "day" ? "grid-cols-[4.5rem_1fr]" : "grid-cols-[4.5rem_repeat(7,1fr)]"}`}><div />{days.map((day) => <button key={day.date} onClick={() => onSelectDay(day.date)} className={`border-l border-white/[0.055] py-4 text-center ${day.date === selectedDate ? "bg-[var(--accent)]/[0.04] text-[var(--accent)]" : "text-[#8a9499]"}`}><span className="text-xs capitalize">{day.weekday}, {day.day}</span></button>)}</div>
      <div className={`relative grid ${view === "day" ? "grid-cols-[4.5rem_1fr]" : "grid-cols-[4.5rem_repeat(7,1fr)]"}`} style={{ height: GRID_HEIGHT }}><div className="relative border-r border-white/[0.055]">{Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => { const hour = START_HOUR + index; return <span key={hour} className="absolute right-2 -translate-y-1/2 text-[9px] text-[#5e686e]" style={{ top: index * HOUR_HEIGHT }}>{String(hour).padStart(2, "0")}:00</span>; })}</div>{days.map((day) => {
        const entries = visitsByDate.get(day.date) ?? [];
        const positions = new Map(layoutCalendarIntervals(entries.map((entry) => ({ id: entry.visit.id, startMinute: entry.startMinute, endMinute: entry.endMinute }))).map((position) => [position.id, position]));
        return <div key={day.date} data-calendar-day={day.date} role="group" aria-label={`Расписание на ${day.date}`} onDragOver={(event) => onDragOverDay(day.date, event)} onDrop={(event) => onDropDay(day.date, event)} className={`relative border-r border-white/[0.055] bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_65px,rgba(255,255,255,0.05)_66px)] ${day.date === selectedDate ? "bg-[color-mix(in_srgb,var(--accent)_2%,transparent)]" : ""} ${draggingId ? "after:pointer-events-none after:absolute after:inset-1 after:rounded-xl after:border after:border-dashed after:border-[var(--accent)]/15" : ""}`}>
          {dropTarget?.date === day.date ? <div className="pointer-events-none absolute left-0 right-0 z-30 border-t border-[var(--accent)]" style={{ top: ((dropTarget.minute - START_HOUR * 60) / 60) * HOUR_HEIGHT }}><span className="absolute -top-3 left-1 rounded-md bg-[var(--accent)] px-1.5 py-0.5 font-display text-[8px] font-semibold text-[#25272c]">{formatTime(dropTarget.minute)}</span></div> : null}
          {entries.map((entry) => {
            const position = positions.get(entry.visit.id)!;
            const visibleStart = Math.max(entry.startMinute, START_HOUR * 60);
            const visibleEnd = Math.min(entry.endMinute, END_HOUR * 60);
            const top = ((visibleStart - START_HOUR * 60) / 60) * HOUR_HEIGHT;
            const height = Math.max(22, ((visibleEnd - visibleStart) / 60) * HOUR_HEIGHT - 3);
            const maximumVisibleLanes = view === "day" ? 5 : 3;
            const visibleLaneCount = Math.min(position.laneCount, maximumVisibleLanes);
            if (position.lane >= visibleLaneCount) return null;
            const collapsedCluster = position.laneCount > visibleLaneCount && position.lane === visibleLaneCount - 1;
            const laneWidth = 100 / visibleLaneCount;
            const laneGap = visibleLaneCount <= 4 ? 3 : 2;
            const densityClass = visibleLaneCount <= 4 ? "rounded-[10px] px-2" : "rounded-md px-1.5";
            const movable = canWrite && !terminalStatuses.has(entry.visit.statusCode);
            if (collapsedCluster) return <article key={`cluster-${entry.visit.id}`} aria-label={`Ещё ${position.laneCount - visibleLaneCount + 1} выездов в этом интервале`} className="absolute z-10 min-w-0 overflow-hidden rounded-md border border-[#b8f7e4]/25 bg-[#b8f7e4]/15 px-1.5 py-2 text-[#b8f7e4]" style={{ top, height, left: `calc(${position.lane * laneWidth}% + ${laneGap}px)`, right: `${laneGap}px` }} title="Откройте режим списка, чтобы увидеть все выезды"><span className="block truncate font-display text-xs font-semibold">+{position.laneCount - visibleLaneCount + 1}</span>{height >= 40 ? <span className="mt-1 block truncate text-[8px]">ещё выездов</span> : null}</article>;
            return <article key={entry.visit.id} aria-label={`${entry.time}, ${entry.visit.client}, ${entry.visit.address}`} draggable={movable && pendingId !== entry.visit.id} onDragStart={(event) => onDragStart(entry.visit, event)} onDragEnd={onDragEnd} className={`absolute z-10 min-w-0 overflow-hidden border py-1.5 transition-[opacity,box-shadow] ${densityClass} ${eventColors[entry.visit.statusCode]} ${movable ? "cursor-grab active:cursor-grabbing" : ""} ${draggingId === entry.visit.id || pendingId === entry.visit.id ? "opacity-45" : "hover:z-20 hover:brightness-110"}`} style={{ top, height, left: `calc(${position.lane * laneWidth}% + ${laneGap}px)`, right: `calc(${100 - (position.lane + 1) * laneWidth}% + ${laneGap}px)` }} title={`${entry.time} · ${entry.visit.client} · ${entry.visit.address}`}>
              <div className="flex min-w-0 items-center gap-1"><span className="min-w-0 flex-1 truncate font-display text-[9px] font-semibold">{entry.time}</span>{movable && visibleLaneCount <= 4 ? <GripVertical className="ml-auto size-3 shrink-0 opacity-55" /> : null}</div>{height >= 36 && visibleLaneCount <= 5 ? <Link href={entry.visit.orderId ? `/orders/${entry.visit.orderId}` : "/calendar"} draggable={false} className="focus-ring mt-1 block min-w-0 rounded"><p className="truncate text-[10px] font-semibold text-white">{entry.visit.client}</p>{height >= 58 && visibleLaneCount <= 2 ? <p className="mt-1 truncate text-[8px] text-white/60">{entry.visit.address}</p> : null}</Link> : null}{height >= 62 && visibleLaneCount <= 2 ? <VisitDispatchCardButton visitId={entry.visit.id} compact className="absolute bottom-1.5 left-1.5 size-5 rounded-md border-0" /> : null}{movable && height >= 62 && visibleLaneCount <= 2 ? <button type="button" onClick={() => onOpenMove(entry.visit)} aria-label={`Точно перенести выезд ${entry.visit.orderNumber ?? entry.visit.client}`} className="focus-ring absolute bottom-1.5 right-1.5 grid size-5 place-items-center rounded-md bg-black/15 text-white/65 hover:text-white"><Clock3 className="size-3" /></button> : null}
            </article>;
          })}
        </div>;
      })}</div>
    </div>
  </section>;
}

export function CalendarWorkspace({ visits, unassignedOrders, anchorDate, initialView, canWrite }: { visits: ServiceVisit[]; unassignedOrders: OrderListItem[]; anchorDate: string; initialView: CalendarView; canWrite: boolean }) {
  const [calendarVisits, setCalendarVisits] = useState(visits);
  const [availableOrders, setAvailableOrders] = useState(unassignedOrders);
  const [view, setView] = useState<CalendarView>(initialView);
  const [query, setQuery] = useState("");
  const [master, setMaster] = useState("all");
  const [region, setRegion] = useState("all");
  const [client, setClient] = useState("all");
  const [objectFilter, setObjectFilter] = useState("all");
  const [status, setStatus] = useState("all");
  const [service, setService] = useState("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ date: string; minute: number } | null>(null);
  const [moveDraft, setMoveDraft] = useState<MoveVisitDraft | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [ordersPanelOpen, setOrdersPanelOpen] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => calendarDay(addDays(weekStart, index))), [weekStart]);
  const [selectedDate, setSelectedDate] = useState(() => days.some((day) => day.date === anchorDate) ? anchorDate : days[0].date);
  const masterOptions = useMemo(() => [{ value: "all", label: "Все мастера" }, { value: "unassigned", label: "Без мастера" }, ...Array.from(new Set(calendarVisits.flatMap((visit) => visit.master ? [visit.master] : []))).sort((left, right) => left.localeCompare(right, "ru")).map((name) => ({ value: name, label: name }))], [calendarVisits]);
  const regionOptions = useMemo(() => [{ value: "all", label: "Все регионы" }, ...Array.from(new Set(calendarVisits.flatMap((visit) => visit.masterRegion ? [visit.masterRegion] : []))).sort((left, right) => left.localeCompare(right, "ru")).map((name) => ({ value: name, label: name }))], [calendarVisits]);
  const clientOptions = useMemo(() => [{ value: "all", label: "Все клиенты" }, ...Array.from(new Set(calendarVisits.map((visit) => visit.client))).sort((left, right) => left.localeCompare(right, "ru")).map((name) => ({ value: name, label: name }))], [calendarVisits]);
  const objectOptions = useMemo(() => [{ value: "all", label: "Все объекты" }, ...Array.from(new Set(calendarVisits.map((visit) => visit.object))).sort((left, right) => left.localeCompare(right, "ru")).map((name) => ({ value: name, label: name }))], [calendarVisits]);
  const serviceOptions = useMemo(() => {
    const services = new Set(calendarVisits.flatMap((visit) => visit.serviceSummary.split(",").map((name) => name.trim()).filter(Boolean)));
    return [{ value: "all", label: "Все услуги" }, ...Array.from(services).sort((left, right) => left.localeCompare(right, "ru")).map((name) => ({ value: name, label: name }))];
  }, [calendarVisits]);
  const statusOptions = useMemo(() => [{ value: "all", label: "Все статусы" }, ...Object.entries(visitStatusLabels).map(([value, label]) => ({ value, label }))], []);
  const visibleVisits = useMemo(() => filterCalendarVisits(calendarVisits, { query, master, region, client, object: objectFilter, status, service }), [calendarVisits, client, master, objectFilter, query, region, service, status]);
  const activeFilterCount = [query.trim(), master, region, client, objectFilter, status, service].filter((value) => value && value !== "all").length;
  const visitsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEntry[]>();
    for (const visit of visibleVisits) {
      const entry = localVisitEntry(visit);
      const entries = grouped.get(entry.date) ?? [];
      entries.push(entry);
      grouped.set(entry.date, entries.toSorted((left, right) => left.startMinute - right.startMinute));
    }
    return grouped;
  }, [visibleVisits]);
  const selectedDateValue = useMemo(() => new Date(`${selectedDate}T12:00:00Z`), [selectedDate]);
  const displayedDays = view === "day" ? [calendarDay(selectedDateValue)] : days;
  const monthGridStart = useMemo(() => startOfMonthGrid(selectedDate), [selectedDate]);
  const monthDays = useMemo(() => Array.from({ length: 42 }, (_, index) => calendarDay(addDays(monthGridStart, index))), [monthGridStart]);
  const navigation = useMemo(() => {
    if (view === "day") return {
      previous: isoDate(addDays(selectedDateValue, -1)), next: isoDate(addDays(selectedDateValue, 1)),
      label: new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(selectedDateValue), unit: "день",
    };
    if (view === "month") return {
      previous: isoDate(addMonths(selectedDateValue, -1)), next: isoDate(addMonths(selectedDateValue, 1)),
      label: new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(selectedDateValue), unit: "месяц",
    };
    return { previous: isoDate(addDays(weekStart, -7)), next: isoDate(addDays(weekStart, 7)), label: weekLabel(weekStart, addDays(weekStart, 6)), unit: "неделю" };
  }, [selectedDateValue, view, weekStart]);

  function openMoveDialog(visit: ServiceVisit, localDate?: string, localTime?: string) {
    const current = localVisitEntry(visit);
    setMessage(null);
    setMoveDraft({ visit, localDate: localDate ?? current.date, localTime: localTime ?? current.time });
  }

  function resetFilters() {
    setQuery("");
    setMaster("all");
    setRegion("all");
    setClient("all");
    setObjectFilter("all");
    setStatus("all");
    setService("all");
  }

  function moveVisit(visit: ServiceVisit, localDate: string, localTime: string, rescheduleReason: string) {
    if (!canWrite || isPending || terminalStatuses.has(visit.statusCode)) return;
    setPendingId(visit.id);
    setMessage(null);
    startTransition(async () => {
      const result = await rescheduleVisitAction(visit.id, visit.version, localDate, localTime, rescheduleReason);
      if (result.status === "success" && result.version && result.scheduledStartAt && result.scheduledEndAt) {
        setCalendarVisits((current) => current.map((entry) => entry.id === visit.id ? { ...entry, version: result.version!, scheduledStartAt: result.scheduledStartAt!, scheduledEndAt: result.scheduledEndAt! } : entry));
        setMoveDraft(null);
        setMessage({ tone: "success", text: `Выезд перенесён на ${localDate}, ${localTime}. Напоминание обновлено.` });
        if (!days.some((day) => day.date === localDate)) router.push(`/calendar?date=${localDate}`);
      } else {
        setMessage({ tone: "error", text: result.message });
      }
      setPendingId(null);
      setDraggingId(null);
      setDropTarget(null);
    });
  }

  function handleDragStart(visit: ServiceVisit, event: React.DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-crm-visit", visit.id);
    setDraggingId(visit.id);
    setMessage(null);
  }

  function handleOrderDragStart(order: OrderListItem, event: React.DragEvent<HTMLElement>) {
    if (!canWrite) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-crm-order", order.id);
    setDraggingId(order.id);
    setMessage(null);
  }

  function targetMinute(event: React.DragEvent<HTMLElement>) {
    const rectangle = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientY - rectangle.top) / rectangle.height));
    const rawMinute = START_HOUR * 60 + ratio * (END_HOUR - START_HOUR) * 60;
    return Math.min(END_HOUR * 60 - SNAP_MINUTES, Math.max(START_HOUR * 60, Math.round(rawMinute / SNAP_MINUTES) * SNAP_MINUTES));
  }

  function handleDragOverDay(date: string, event: React.DragEvent<HTMLElement>) {
    if (!canWrite || !draggingId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes("application/x-crm-order") ? "copy" : "move";
    const minute = targetMinute(event);
    setDropTarget((current) => current?.date === date && current.minute === minute ? current : { date, minute });
  }

  function createVisitFromOrder(order: OrderListItem, localDate: string, localTime: string) {
    if (!canWrite || isPending) return;
    setPendingId(order.id);
    setMessage(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("idempotencyKey", crypto.randomUUID());
      formData.set("orderId", order.id);
      formData.set("localDate", localDate);
      formData.set("localTime", localTime);
      formData.set("durationMinutes", "120");
      formData.set("assignedMasterId", "");
      formData.set("notes", "");
      const result = await createVisitAction({ status: "idle", message: null, fieldErrors: {}, visitId: null }, formData);
      if (result.status === "success") {
        setAvailableOrders((current) => current.filter((entry) => entry.id !== order.id));
        setMessage({ tone: "success", text: `Заказ ${order.number} добавлен в календарь на ${localDate}, ${localTime}.` });
        router.refresh();
      } else {
        setMessage({ tone: "error", text: result.message ?? "Не удалось добавить выезд." });
      }
      setPendingId(null);
      setDraggingId(null);
      setDropTarget(null);
    });
  }

  function handleDropDay(date: string, event: React.DragEvent<HTMLElement>, fixedMinute?: number) {
    event.preventDefault();
    const visitId = event.dataTransfer.getData("application/x-crm-visit");
    const orderId = event.dataTransfer.getData("application/x-crm-order");
    const visit = calendarVisits.find((entry) => entry.id === visitId);
    const order = availableOrders.find((entry) => entry.id === orderId);
    const minute = fixedMinute ?? targetMinute(event);
    setDraggingId(null);
    setDropTarget(null);
    if (visit) openMoveDialog(visit, date, formatTime(minute));
    else if (order) createVisitFromOrder(order, date, formatTime(minute));
  }

  return <div className="mt-[clamp(1.2rem,0.9rem+0.7vw,2rem)]">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-wrap gap-2">
        <div className="flex max-w-full overflow-x-auto rounded-xl border border-white/[0.07] p-1">{(["day", "week", "month", "list"] as const).map((option) => <button key={option} onClick={() => setView(option)} className={`focus-ring shrink-0 rounded-lg px-4 py-2 text-xs ${view === option ? "bg-[var(--accent)] font-semibold text-[#25272c]" : "text-[#7f898f]"}`}>{option === "day" ? "День" : option === "week" ? "Неделя" : option === "month" ? "Месяц" : "Список"}</button>)}</div>
        <div className="flex items-center rounded-xl border border-white/[0.07]"><Link href={`/calendar?date=${navigation.previous}&view=${view}`} aria-label={`Предыдущий ${navigation.unit}`} className="focus-ring grid size-10 place-items-center text-[#6d777d] hover:text-white"><ChevronLeft className="size-4" /></Link><span className="min-w-40 px-3 text-center font-display text-xs capitalize text-white">{navigation.label}</span><Link href={`/calendar?date=${navigation.next}&view=${view}`} aria-label={`Следующий ${navigation.unit}`} className="focus-ring grid size-10 place-items-center text-[#6d777d] hover:text-white"><ChevronRight className="size-4" /></Link></div>
      </div>
      <button type="button" onClick={() => setOrdersPanelOpen((open) => !open)} aria-expanded={ordersPanelOpen} className="focus-ring flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 text-sm font-semibold text-[#25272c]"><ListPlus className="size-4" />Выбрать заказ для выезда</button>
    </div>

    <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(16rem,1fr)_auto_auto] lg:items-start">
      <label data-calendar-filter="query" className="focus-within:border-[var(--accent)]/30 flex h-11 min-w-0 items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 text-[#687279]"><Search className="size-4 shrink-0" /><span className="sr-only">Поиск по календарю</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#59636a]" placeholder="Номер, клиент, адрес, мастер или услуга" /></label>
      <details className="group relative">
        <summary className="focus-ring flex h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-4 text-xs text-[#899399] hover:text-white [&::-webkit-details-marker]:hidden"><SlidersHorizontal className="size-4 text-[var(--accent)]" />Фильтры{activeFilterCount ? <span className="grid size-5 place-items-center rounded-full bg-[var(--accent)] text-[9px] font-semibold text-[#25272c]">{activeFilterCount}</span> : null}</summary>
        <div className="absolute right-0 z-40 mt-2 w-[min(44rem,calc(100vw-2rem))] rounded-[16px] border border-white/[0.09] bg-[#151b1f] p-4 shadow-2xl sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div data-calendar-filter="master"><OrderPicker label="Мастер" value={master} onChange={setMaster} placeholder="Все мастера" options={masterOptions} /></div>
            <div data-calendar-filter="region"><OrderPicker label="Регион" value={region} onChange={setRegion} placeholder="Все регионы" options={regionOptions} /></div>
            <div data-calendar-filter="client"><OrderPicker label="Клиент" value={client} onChange={setClient} placeholder="Все клиенты" options={clientOptions} /></div>
            <div data-calendar-filter="object"><OrderPicker label="Объект" value={objectFilter} onChange={setObjectFilter} placeholder="Все объекты" options={objectOptions} /></div>
            <div data-calendar-filter="status"><OrderPicker label="Статус" value={status} onChange={setStatus} placeholder="Все статусы" options={statusOptions} /></div>
            <div data-calendar-filter="service"><OrderPicker label="Услуга" value={service} onChange={setService} placeholder="Все услуги" options={serviceOptions} /></div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4"><p className="text-[10px] text-[#687279]">Показано {visibleVisits.length} из {calendarVisits.length} выездов</p><button type="button" onClick={resetFilters} disabled={!activeFilterCount} className="focus-ring flex h-9 items-center gap-2 rounded-lg border border-white/[0.07] px-3 text-[10px] text-[#899399] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"><RotateCcw className="size-3.5" />Сбросить</button></div>
        </div>
      </details>
      <div className="flex h-11 items-center justify-center gap-3 rounded-xl border border-white/[0.07] px-3"><span className="text-[10px] text-[#687279]">{visibleVisits.length} из {calendarVisits.length}</span>{canWrite ? <span className="hidden items-center gap-1.5 text-[9px] text-[#687279] lg:flex"><GripVertical className="size-3.5 text-[var(--accent)]" />drag & drop</span> : null}</div>
    </div>

    {message ? <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 flex items-center gap-2 rounded-[12px] border p-3 text-xs ${message.tone === "success" ? "border-[#b8f7e4]/20 bg-[#b8f7e4]/[0.05] text-[#8ed7b8]" : "border-[#ef646a]/20 bg-[#ef646a]/[0.05] text-[#dc969a]"}`}>{message.tone === "success" ? <Check className="size-4" /> : <Clock3 className="size-4" />}{message.text}</p> : null}

    {view === "list" ? <CalendarList visits={visibleVisits} canWrite={canWrite} onOpenMove={openMoveDialog} /> : view === "month" ? <div className={`mt-3 grid gap-3 ${ordersPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-1"}`}><section className="surface-panel p-3 sm:p-4"><div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-white/[0.055]">{monthDays.map((day) => { const count = visitsByDate.get(day.date)?.length ?? 0; const inMonth = day.date.startsWith(selectedDate.slice(0, 7)); return <button key={day.date} onClick={() => { setSelectedDate(day.date); setView("day"); }} onDragOver={(event) => { if (canWrite && draggingId) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={(event) => handleDropDay(day.date, event, 9 * 60)} className={`min-h-20 bg-[var(--surface)] p-2 text-left sm:min-h-28 ${day.date === selectedDate ? "bg-[var(--accent)]/[0.045]" : ""} ${inMonth ? "" : "opacity-35"} ${draggingId ? "hover:bg-[var(--accent)]/[0.08]" : ""}`}><span className="text-xs text-white">{day.day}</span>{count ? <span className="mt-3 block rounded-lg bg-[#b8f7e4]/15 px-2 py-1 text-[9px] text-[#b8f7e4]">{count} выезд.</span> : null}</button>; })}</div></section>{ordersPanelOpen ? <UnassignedOrdersPanel orders={availableOrders} canWrite={canWrite} pendingId={pendingId} onClose={() => setOrdersPanelOpen(false)} onDragStart={handleOrderDragStart} onDragEnd={() => { setDraggingId(null); setDropTarget(null); }} /> : null}</div> : <div className={`mt-3 grid gap-3 ${ordersPanelOpen ? "xl:grid-cols-[minmax(0,1fr)_20rem]" : "grid-cols-1"}`}>
      <ScheduleGrid days={displayedDays} visitsByDate={visitsByDate} selectedDate={selectedDate} view={view} canWrite={canWrite} draggingId={draggingId} pendingId={pendingId} dropTarget={dropTarget} onSelectDay={(date) => { setSelectedDate(date); setView("day"); }} onDragStart={handleDragStart} onDragEnd={() => { setDraggingId(null); setDropTarget(null); }} onDragOverDay={handleDragOverDay} onDropDay={handleDropDay} onOpenMove={openMoveDialog} />
      {ordersPanelOpen ? <UnassignedOrdersPanel orders={availableOrders} canWrite={canWrite} pendingId={pendingId} onClose={() => setOrdersPanelOpen(false)} onDragStart={handleOrderDragStart} onDragEnd={() => { setDraggingId(null); setDropTarget(null); }} /> : null}
    </div>}

    <MoveVisitDialog key={moveDraft ? `${moveDraft.visit.id}:${moveDraft.localDate}:${moveDraft.localTime}` : "closed"} draft={moveDraft} pending={isPending} error={message?.tone === "error" ? message.text : null} onClose={() => { if (!isPending) setMoveDraft(null); }} onMove={moveVisit} />
  </div>;
}
