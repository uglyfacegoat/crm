"use client";

import { CalendarDays, Check, Clock3, GripVertical, History, MoreVertical, Pencil, RotateCcw, RotateCw, Search, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { completeTaskAction, rescheduleTaskAction } from "@/app/(workspace)/tasks/actions";
import { TaskManagementDialogs } from "@/components/tasks/task-management-dialogs";
import { TaskDistributionChart } from "@/components/tasks/task-distribution-chart";
import { Dialog } from "@/components/ui/dialog";
import type { TaskCard, TaskColumn, TaskPriority, TaskSnapshot } from "@/server/tasks/types";

const columns: { id: TaskColumn; title: string; tone: string }[] = [
  { id: "overdue", title: "Просроченные", tone: "#ef646a" },
  { id: "today", title: "На сегодня", tone: "#b8f7e4" },
  { id: "upcoming", title: "Ближайшие", tone: "#b8f7e4" },
  { id: "unscheduled", title: "Без срока", tone: "#849097" },
];

const priorityLabels = { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критичный" } as const;
const completedAtFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" });
type TaskSourceFilter = "all" | TaskCard["source"];
type TaskFilters = { priority: "all" | TaskPriority; source: TaskSourceFilter; assignee: string };
const defaultFilters: TaskFilters = { priority: "all", source: "all", assignee: "" };

function taskMatchesFilters(task: TaskCard, filters: TaskFilters, normalizedQuery: string) {
  if (filters.priority !== "all" && task.priority !== filters.priority) return false;
  if (filters.source !== "all" && task.source !== filters.source) return false;
  if (filters.assignee && task.assignedMemberId !== filters.assignee) return false;

  return !normalizedQuery || `${task.title} ${task.meta} ${task.description ?? ""} ${task.assigneeName ?? ""}`
    .toLocaleLowerCase("ru")
    .includes(normalizedQuery);
}

function FilterChoice<T extends string>({ value, current, label, onChange }: { value: T; current: T; label: string; onChange: (value: T) => void }) {
  const selected = value === current;
  return <button type="button" role="radio" aria-checked={selected} onClick={() => onChange(value)} className={`focus-ring min-h-10 rounded-[11px] border px-3 text-left text-xs transition-colors ${selected ? "border-[var(--accent)]/30 bg-[var(--accent)]/[0.08] text-white" : "border-white/[0.07] text-[#858f94] hover:bg-white/[0.035] hover:text-white"}`}>{label}</button>;
}

export function TasksWorkspace({ snapshot, canWrite }: { snapshot: TaskSnapshot; canWrite: boolean }) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "completed">("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(defaultFilters);
  const [draftFilters, setDraftFilters] = useState(defaultFilters);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"edit" | "cancel" | "history" | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const visibleTasks = useMemo(() => tasks.filter((task) => (activeTab === "all" || task.assignedMemberId === snapshot.currentMemberId) && taskMatchesFilters(task, filters, normalizedQuery)), [activeTab, filters, normalizedQuery, snapshot.currentMemberId, tasks]);
  const visibleCompletedTasks = useMemo(() => snapshot.completedTasks.filter((task) => taskMatchesFilters(task, filters, normalizedQuery)), [filters, normalizedQuery, snapshot.completedTasks]);
  const activeFilterCount = [filters.priority !== "all", filters.source !== "all", Boolean(filters.assignee)].filter(Boolean).length;
  const dialogTask = tasks.find((task) => task.id === dialogTaskId) ?? null;

  function resetFilters() { setQuery(""); setFilters(defaultFilters); setDraftFilters(defaultFilters); }

  function openDialog(task: TaskCard, mode: "edit" | "cancel" | "history") {
    setMenuTaskId(null);
    setDialogTaskId(task.id);
    setDialogMode(mode);
  }

  function closeDialog() {
    setDialogTaskId(null);
    setDialogMode(null);
  }

  function persistMove(task: TaskCard, column: TaskColumn) {
    if (!canWrite || task.source === "visit_reminder" || task.column === column || isPending) return;
    const previousTasks = tasks;
    setMessage(null);
    setMenuTaskId(null);
    setPendingTaskId(task.id);
    setTasks((current) => current.map((entry) => entry.id === task.id ? { ...entry, column, due: column === "unscheduled" ? "Без срока" : "Сохраняем новый срок…" } : entry));
    startTransition(async () => {
      const result = await rescheduleTaskAction(task.id, task.version, column);
      if (result.status === "error") {
        setTasks(previousTasks);
        setMessage(result.message);
      } else {
        setTasks((current) => current.map((entry) => entry.id === task.id ? { ...entry, version: result.version ?? entry.version } : entry));
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  function complete(task: TaskCard) {
    if (!canWrite || isPending) return;
    const previousTasks = tasks;
    setMessage(null);
    setPendingTaskId(task.id);
    setTasks((current) => current.filter((entry) => entry.id !== task.id));
    startTransition(async () => {
      const result = await completeTaskAction(task.id, task.version);
      if (result.status === "error") {
        setTasks(previousTasks);
        setMessage(result.message);
      } else {
        router.refresh();
      }
      setPendingTaskId(null);
    });
  }

  return (
    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid gap-4 2xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="mb-4 flex min-w-0 gap-2 overflow-x-auto">
          <button onClick={() => setActiveTab("all")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "all" ? "bg-[var(--accent)] text-[#25272c]" : "soft-button text-[#899298]"}`}>Все задачи <span className="ml-2 opacity-60">{tasks.length}</span></button>
          <button onClick={() => setActiveTab("mine")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "mine" ? "bg-[var(--accent)] text-[#25272c]" : "soft-button text-[#899298]"}`}>Мои задачи <span className="ml-2 opacity-60">{tasks.filter((task) => task.assignedMemberId === snapshot.currentMemberId).length}</span></button>
          <button onClick={() => setActiveTab("completed")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "completed" ? "bg-[var(--accent)] text-[#25272c]" : "soft-button text-[#899298]"}`}>Последние выполненные <span className="ml-2 opacity-60">{snapshot.completedTasks.length}</span></button>
          <span className="ml-auto flex shrink-0 items-center gap-2 rounded-[12px] border border-white/[0.06] px-3 text-[10px] text-[#69737a]"><Sparkles className="size-3.5 text-[var(--accent)]" />Выезды создают напоминания автоматически</span>
        </div>
        <div className="mb-4 flex min-w-0 gap-2"><label className="soft-button flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] px-3 sm:max-w-md"><Search className="size-4 shrink-0 text-[#687279]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Задача, заказ, описание или сотрудник" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-[#59636a]" /></label><button type="button" onClick={() => { setDraftFilters(filters); setFiltersOpen(true); }} className={`focus-ring flex h-11 shrink-0 items-center gap-2 rounded-[12px] border px-3 text-xs ${activeFilterCount ? "border-[var(--accent)]/25 bg-[var(--accent)]/[0.06] text-white" : "border-white/[0.07] text-[#858f94]"}`}><SlidersHorizontal className="size-4" />Фильтры{activeFilterCount ? <span className="grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold text-[#25272c]">{activeFilterCount}</span> : null}</button>{query.trim() || activeFilterCount ? <button type="button" onClick={resetFilters} aria-label="Сбросить фильтры задач" className="focus-ring grid size-11 shrink-0 place-items-center rounded-[12px] border border-white/[0.07] text-[#7c858b]"><RotateCcw className="size-3.5" /></button> : null}</div>
        {message ? <p role="alert" className="mb-4 flex items-center gap-2 rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.05] p-3 text-xs text-[#d89599]"><RotateCw className="size-4" />{message}</p> : null}
        {activeTab === "completed" ? <section className="surface-panel overflow-hidden"><header className="border-b border-white/[0.06] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold text-white">Последние выполненные задачи</h2><p className="mt-1 text-xs text-[#69737a]">До 50 последних завершений с ответственным и связью с заказом.</p></header>{visibleCompletedTasks.length ? <div className="divide-y divide-white/[0.055]">{visibleCompletedTasks.map((task) => <article key={task.id} className="grid gap-3 px-4 py-4 hover:bg-white/[0.025] sm:px-5 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#b8f7e4]/10 text-[#b8f7e4]"><Check className="size-3.5" /></span>{task.relatedOrderId ? <Link href={`/orders/${task.relatedOrderId}`} className="focus-ring min-w-0 truncate rounded text-sm font-medium text-white hover:text-[var(--accent)]">{task.title}</Link> : <h3 className="min-w-0 truncate text-sm font-medium text-white">{task.title}</h3>}</div><p className="mt-1 pl-9 text-[10px] text-[#69737a]">{task.meta}</p></div><p className="text-xs text-[#899399]">{task.assigneeName ?? "Без ответственного"}</p><time dateTime={task.completedAt} className="text-xs text-[#b8f7e4] md:text-right">{completedAtFormatter.format(new Date(task.completedAt))}</time></article>)}</div> : <div className="grid min-h-64 place-items-center text-center"><div><Check className="mx-auto size-8 text-[#4f595f]" /><p className="mt-3 text-sm text-[#7e888e]">Выполненных задач по выбранным условиям нет</p><button type="button" onClick={resetFilters} className="focus-ring mt-4 rounded-[10px] bg-white/[0.07] px-3 py-2 text-xs text-white">Сбросить фильтры</button></div></div>}</section> : null}
        <div className={`${activeTab === "completed" ? "hidden" : "grid"} gap-3 lg:grid-cols-2 2xl:grid-cols-4`}>
          {columns.map((column) => {
            const columnTasks = visibleTasks.filter((task) => task.column === column.id);
            return <section key={column.id} onDragOver={(event) => { if (canWrite) event.preventDefault(); }} onDrop={(event) => { const task = tasks.find((entry) => entry.id === event.dataTransfer.getData("text/task-id")); if (task) persistMove(task, column.id); }} className="surface-panel flex min-h-80 min-w-0 flex-col p-3">
              <header className="flex items-center gap-2 px-1 pb-3"><span className="size-2 rounded-full" style={{ backgroundColor: column.tone }} /><h2 className="text-sm font-semibold text-white">{column.title}</h2><span className="ml-auto rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-[#808a90]">{columnTasks.length}</span></header>
              <div className="space-y-2">{columnTasks.map((task) => <article key={task.id} draggable={canWrite && task.source === "manual" && !isPending} onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)} className={`group relative rounded-[13px] border border-white/[0.06] bg-white/[0.025] p-3.5 ${pendingTaskId === task.id ? "opacity-55" : ""}`} style={{ borderLeftColor: column.tone }}>
                <div className="flex items-start gap-2">{canWrite && task.source === "manual" ? <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-[#4f595f] opacity-0 transition-opacity group-hover:opacity-100" /> : null}<div className="min-w-0 flex-1">{task.relatedOrderId ? <Link href={`/orders/${task.relatedOrderId}`} className="focus-ring rounded text-xs font-semibold leading-5 text-[#e3e7e3] hover:text-white">{task.title}</Link> : <h3 className="text-xs font-semibold leading-5 text-[#e3e7e3]">{task.title}</h3>}<p className="mt-1 text-[10px] text-[#6f797f]">{task.meta}</p>{task.description ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#7d878c]">{task.description}</p> : null}</div>{canWrite ? <button type="button" aria-label={`Действия с задачей ${task.title}`} aria-expanded={menuTaskId === task.id} onClick={() => setMenuTaskId((current) => current === task.id ? null : task.id)} className="focus-ring rounded-md p-1 text-[#626c72]"><MoreVertical className="size-3.5" /></button> : <button type="button" onClick={() => openDialog(task, "history")} aria-label={`История задачи ${task.title}`} className="focus-ring rounded-md p-1 text-[#626c72]"><History className="size-3.5" /></button>}</div>
                {menuTaskId === task.id ? <div className="absolute right-3 top-10 z-10 w-52 rounded-[12px] border border-white/[0.1] bg-[#11191e] p-1.5 shadow-2xl" role="menu" aria-label="Действия с задачей"><button type="button" role="menuitem" onClick={() => openDialog(task, "edit")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><Pencil className="size-3.5" />Редактировать</button><button type="button" role="menuitem" onClick={() => openDialog(task, "history")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><History className="size-3.5" />История</button>{task.source === "manual" ? <><div className="my-1 border-t border-white/[0.07]" />{columns.filter((target) => target.id !== task.column).map((target) => <button key={target.id} type="button" role="menuitem" onClick={() => persistMove(task, target.id)} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><Clock3 className="size-3.5" /><span className="size-1.5 rounded-full" style={{ backgroundColor: target.tone }} />{target.title}</button>)}<div className="my-1 border-t border-white/[0.07]" /><button type="button" role="menuitem" onClick={() => openDialog(task, "cancel")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#d78085] hover:bg-[#ef646a]/[0.06]"><Trash2 className="size-3.5" />Отменить задачу</button></> : <p className="border-t border-white/[0.07] px-2.5 py-2 text-[9px] leading-4 text-[#687279]">Срок и отмена управляются через выезд.</p>}</div> : null}
                <div className="mt-4 flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[10px]" style={{ color: column.tone }}>{task.due}</p>{task.source === "visit_reminder" ? <span title="Создано по выезду" className="grid size-7 place-items-center rounded-lg bg-[var(--accent)]/[0.06] text-[var(--accent)]"><Sparkles className="size-3" /></span> : null}<span title={`${task.assigneeName ?? "Без ответственного"} · приоритет: ${priorityLabels[task.priority]}`} className="grid size-7 place-items-center rounded-full bg-white/[0.06] text-[9px] font-semibold text-[#cbd0cd]">{task.assignee}</span>{canWrite ? <button type="button" onClick={() => complete(task)} disabled={isPending} aria-label={`Отметить задачу «${task.title}» выполненной`} className="focus-ring grid size-7 place-items-center rounded-lg border border-white/[0.08] text-[#707a80] hover:border-[#b8f7e4]/40 hover:text-[#b8f7e4] disabled:opacity-50"><Check className="size-3.5" /></button> : null}</div>
              </article>)}</div>
              {!columnTasks.length ? <p className="grid flex-1 place-items-center py-8 text-center text-xs text-[#5f696f]">В этом разделе задач нет</p> : null}
            </section>;
          })}
        </div>
      </div>

      <aside className="grid content-start gap-4 sm:grid-cols-2 2xl:grid-cols-1">
        <section className="surface-panel p-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold text-white">Распределение задач</h2><p className="mt-1 text-[10px] text-[#687279]">Структура открытой очереди по срокам</p></div><CalendarDays className="size-4 text-[var(--accent)]" /></div><TaskDistributionChart tasks={tasks} /></section>
        <section className="surface-panel p-4"><h2 className="text-sm font-semibold text-white">Сводка</h2><dl className="mt-4 space-y-3 text-xs"><div className="flex items-center gap-3"><dt className="flex-1 text-[#768087]">Открыто сейчас</dt><dd className="font-display font-semibold text-white">{tasks.length}</dd></div><div className="flex items-center gap-3"><dt className="flex-1 text-[#768087]">Автоматических</dt><dd className="font-display font-semibold text-[var(--accent)]">{tasks.filter((task) => task.source === "visit_reminder").length}</dd></div><div className="flex items-center gap-3 border-t border-white/[0.06] pt-3"><dt className="flex-1 text-[#768087]">Выполнено за 30 дней</dt><dd className="font-display font-semibold text-[#b8f7e4]">{snapshot.completedLast30Days}</dd></div></dl></section>
      </aside>
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Фильтры задач" description="Отберите открытые и выполненные задачи по приоритету, происхождению и ответственному сотруднику.">
        <div className="space-y-7 p-5 sm:p-7">
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Приоритет</legend><div className="grid gap-2 sm:grid-cols-2" role="radiogroup"><FilterChoice value="all" current={draftFilters.priority} label="Любой приоритет" onChange={(priority) => setDraftFilters((current) => ({ ...current, priority }))} />{Object.entries(priorityLabels).map(([priority, label]) => <FilterChoice key={priority} value={priority as TaskPriority} current={draftFilters.priority} label={label} onChange={(selectedPriority) => setDraftFilters((current) => ({ ...current, priority: selectedPriority }))} />)}</div></fieldset>
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Источник</legend><div className="grid gap-2 sm:grid-cols-3" role="radiogroup"><FilterChoice value="all" current={draftFilters.source} label="Все задачи" onChange={(source) => setDraftFilters((current) => ({ ...current, source }))} /><FilterChoice value="manual" current={draftFilters.source} label="Ручные" onChange={(source) => setDraftFilters((current) => ({ ...current, source }))} /><FilterChoice value="visit_reminder" current={draftFilters.source} label="По выездам" onChange={(source) => setDraftFilters((current) => ({ ...current, source }))} /></div></fieldset>
          <fieldset><legend className="mb-3 text-[10px] font-semibold uppercase tracking-[0.13em] text-[#69737a]">Ответственный</legend><div className="max-h-56 space-y-1 overflow-y-auto rounded-[13px] border border-white/[0.07] bg-black/10 p-1.5" role="radiogroup"><FilterChoice value="" current={draftFilters.assignee} label="Любой сотрудник" onChange={(assignee) => setDraftFilters((current) => ({ ...current, assignee }))} />{snapshot.assigneeOptions.map((assignee) => <FilterChoice key={assignee.id} value={assignee.id} current={draftFilters.assignee} label={assignee.displayName} onChange={(selectedAssignee) => setDraftFilters((current) => ({ ...current, assignee: selectedAssignee }))} />)}</div></fieldset>
        </div>
        <footer className="sticky bottom-0 mt-auto grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-2 border-t border-white/[0.07] bg-[#25272c]/95 p-4 backdrop-blur-xl sm:p-5"><button type="button" onClick={() => setDraftFilters(defaultFilters)} className="focus-ring h-11 rounded-[12px] border border-white/[0.08] px-4 text-xs text-[#899399]"><RotateCcw className="mr-2 inline size-3.5" />Очистить</button><button type="button" onClick={() => { setFilters(draftFilters); setFiltersOpen(false); }} className="focus-ring h-11 rounded-[12px] bg-[var(--accent)] px-4 text-xs font-semibold text-[#25272c]">Показать задачи</button></footer>
      </Dialog>
      <TaskManagementDialogs task={dialogTask} mode={dialogMode} assigneeOptions={snapshot.assigneeOptions} timeZone={snapshot.timeZone} onClose={closeDialog} />
    </div>
  );
}
