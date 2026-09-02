"use client";

import { CalendarDays, Check, Clock3, GripVertical, History, MoreVertical, Pencil, RotateCw, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { completeTaskAction, rescheduleTaskAction } from "@/app/(workspace)/tasks/actions";
import { TaskManagementDialogs } from "@/components/tasks/task-management-dialogs";
import type { TaskCard, TaskColumn, TaskSnapshot } from "@/server/tasks/types";

const columns: { id: TaskColumn; title: string; tone: string }[] = [
  { id: "overdue", title: "Просроченные", tone: "#ef646a" },
  { id: "today", title: "На сегодня", tone: "#edf43b" },
  { id: "upcoming", title: "Ближайшие", tone: "#65b7ee" },
  { id: "unscheduled", title: "Без срока", tone: "#849097" },
];

const priorityLabels = { low: "Низкий", normal: "Обычный", high: "Высокий", critical: "Критичный" } as const;
const completedAtFormatter = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" });

export function TasksWorkspace({ snapshot, canWrite }: { snapshot: TaskSnapshot; canWrite: boolean }) {
  const [tasks, setTasks] = useState(snapshot.tasks);
  const [activeTab, setActiveTab] = useState<"all" | "mine" | "completed">("all");
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [dialogTaskId, setDialogTaskId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"edit" | "cancel" | "history" | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const visibleTasks = useMemo(() => tasks.filter((task) => activeTab === "all" || task.assignedMemberId === snapshot.currentMemberId), [activeTab, snapshot.currentMemberId, tasks]);
  const dialogTask = tasks.find((task) => task.id === dialogTaskId) ?? null;

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
          <button onClick={() => setActiveTab("all")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "all" ? "bg-[var(--accent)] text-[#111509]" : "soft-button text-[#899298]"}`}>Все задачи <span className="ml-2 opacity-60">{tasks.length}</span></button>
          <button onClick={() => setActiveTab("mine")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "mine" ? "bg-[var(--accent)] text-[#111509]" : "soft-button text-[#899298]"}`}>Мои задачи <span className="ml-2 opacity-60">{tasks.filter((task) => task.assignedMemberId === snapshot.currentMemberId).length}</span></button>
          <button onClick={() => setActiveTab("completed")} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-xs font-medium ${activeTab === "completed" ? "bg-[var(--accent)] text-[#111509]" : "soft-button text-[#899298]"}`}>Последние выполненные <span className="ml-2 opacity-60">{snapshot.completedTasks.length}</span></button>
          <span className="ml-auto flex shrink-0 items-center gap-2 rounded-[12px] border border-white/[0.06] px-3 text-[10px] text-[#69737a]"><Sparkles className="size-3.5 text-[var(--accent)]" />Выезды создают напоминания автоматически</span>
        </div>
        {message ? <p role="alert" className="mb-4 flex items-center gap-2 rounded-[12px] border border-[#ef646a]/20 bg-[#ef646a]/[0.05] p-3 text-xs text-[#d89599]"><RotateCw className="size-4" />{message}</p> : null}
        {activeTab === "completed" ? <section className="surface-panel overflow-hidden"><header className="border-b border-white/[0.06] px-4 py-4 sm:px-5"><h2 className="text-sm font-semibold text-white">Последние выполненные задачи</h2><p className="mt-1 text-xs text-[#69737a]">До 50 последних завершений с ответственным и связью с заказом.</p></header>{snapshot.completedTasks.length ? <div className="divide-y divide-white/[0.055]">{snapshot.completedTasks.map((task) => <article key={task.id} className="grid gap-3 px-4 py-4 hover:bg-white/[0.025] sm:px-5 md:grid-cols-[minmax(0,1fr)_12rem_10rem] md:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#69d3a4]/10 text-[#69d3a4]"><Check className="size-3.5" /></span>{task.relatedOrderId ? <Link href={`/orders/${task.relatedOrderId}`} className="focus-ring min-w-0 truncate rounded text-sm font-medium text-white hover:text-[var(--accent)]">{task.title}</Link> : <h3 className="min-w-0 truncate text-sm font-medium text-white">{task.title}</h3>}</div><p className="mt-1 pl-9 text-[10px] text-[#69737a]">{task.meta}</p></div><p className="text-xs text-[#899399]">{task.assigneeName ?? "Без ответственного"}</p><time dateTime={task.completedAt} className="text-xs text-[#69d3a4] md:text-right">{completedAtFormatter.format(new Date(task.completedAt))}</time></article>)}</div> : <div className="grid min-h-64 place-items-center text-center"><div><Check className="mx-auto size-8 text-[#4f595f]" /><p className="mt-3 text-sm text-[#7e888e]">Выполненных задач пока нет</p></div></div>}</section> : null}
        <div className={`${activeTab === "completed" ? "hidden" : "grid"} gap-3 lg:grid-cols-2 2xl:grid-cols-4`}>
          {columns.map((column) => {
            const columnTasks = visibleTasks.filter((task) => task.column === column.id);
            return <section key={column.id} onDragOver={(event) => { if (canWrite) event.preventDefault(); }} onDrop={(event) => { const task = tasks.find((entry) => entry.id === event.dataTransfer.getData("text/task-id")); if (task) persistMove(task, column.id); }} className="surface-panel flex min-h-80 min-w-0 flex-col p-3">
              <header className="flex items-center gap-2 px-1 pb-3"><span className="size-2 rounded-full" style={{ backgroundColor: column.tone }} /><h2 className="text-sm font-semibold text-white">{column.title}</h2><span className="ml-auto rounded-full bg-white/[0.05] px-2 py-1 text-[10px] text-[#808a90]">{columnTasks.length}</span></header>
              <div className="space-y-2">{columnTasks.map((task) => <article key={task.id} draggable={canWrite && task.source === "manual" && !isPending} onDragStart={(event) => event.dataTransfer.setData("text/task-id", task.id)} className={`group relative rounded-[13px] border border-white/[0.06] bg-white/[0.025] p-3.5 ${pendingTaskId === task.id ? "opacity-55" : ""}`} style={{ borderLeftColor: column.tone }}>
                <div className="flex items-start gap-2">{canWrite && task.source === "manual" ? <GripVertical className="mt-0.5 size-3.5 shrink-0 cursor-grab text-[#4f595f] opacity-0 transition-opacity group-hover:opacity-100" /> : null}<div className="min-w-0 flex-1">{task.relatedOrderId ? <Link href={`/orders/${task.relatedOrderId}`} className="focus-ring rounded text-xs font-semibold leading-5 text-[#e3e7e3] hover:text-white">{task.title}</Link> : <h3 className="text-xs font-semibold leading-5 text-[#e3e7e3]">{task.title}</h3>}<p className="mt-1 text-[10px] text-[#6f797f]">{task.meta}</p>{task.description ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-[#7d878c]">{task.description}</p> : null}</div>{canWrite ? <button type="button" aria-label={`Действия с задачей ${task.title}`} aria-expanded={menuTaskId === task.id} onClick={() => setMenuTaskId((current) => current === task.id ? null : task.id)} className="focus-ring rounded-md p-1 text-[#626c72]"><MoreVertical className="size-3.5" /></button> : <button type="button" onClick={() => openDialog(task, "history")} aria-label={`История задачи ${task.title}`} className="focus-ring rounded-md p-1 text-[#626c72]"><History className="size-3.5" /></button>}</div>
                {menuTaskId === task.id ? <div className="absolute right-3 top-10 z-10 w-52 rounded-[12px] border border-white/[0.1] bg-[#11191e] p-1.5 shadow-2xl" role="menu" aria-label="Действия с задачей"><button type="button" role="menuitem" onClick={() => openDialog(task, "edit")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><Pencil className="size-3.5" />Редактировать</button><button type="button" role="menuitem" onClick={() => openDialog(task, "history")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><History className="size-3.5" />История</button>{task.source === "manual" ? <><div className="my-1 border-t border-white/[0.07]" />{columns.filter((target) => target.id !== task.column).map((target) => <button key={target.id} type="button" role="menuitem" onClick={() => persistMove(task, target.id)} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#a5adb1] hover:bg-white/[0.05] hover:text-white"><Clock3 className="size-3.5" /><span className="size-1.5 rounded-full" style={{ backgroundColor: target.tone }} />{target.title}</button>)}<div className="my-1 border-t border-white/[0.07]" /><button type="button" role="menuitem" onClick={() => openDialog(task, "cancel")} className="focus-ring flex min-h-9 w-full items-center gap-2 rounded-[8px] px-2.5 text-left text-[10px] text-[#d78085] hover:bg-[#ef646a]/[0.06]"><Trash2 className="size-3.5" />Отменить задачу</button></> : <p className="border-t border-white/[0.07] px-2.5 py-2 text-[9px] leading-4 text-[#687279]">Срок и отмена управляются через выезд.</p>}</div> : null}
                <div className="mt-4 flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-[10px]" style={{ color: column.tone }}>{task.due}</p>{task.source === "visit_reminder" ? <span title="Создано по выезду" className="grid size-7 place-items-center rounded-lg bg-[var(--accent)]/[0.06] text-[var(--accent)]"><Sparkles className="size-3" /></span> : null}<span title={`${task.assigneeName ?? "Без ответственного"} · приоритет: ${priorityLabels[task.priority]}`} className="grid size-7 place-items-center rounded-full bg-white/[0.06] text-[9px] font-semibold text-[#cbd0cd]">{task.assignee}</span>{canWrite ? <button type="button" onClick={() => complete(task)} disabled={isPending} aria-label={`Отметить задачу «${task.title}» выполненной`} className="focus-ring grid size-7 place-items-center rounded-lg border border-white/[0.08] text-[#707a80] hover:border-[#69d3a4]/40 hover:text-[#69d3a4] disabled:opacity-50"><Check className="size-3.5" /></button> : null}</div>
              </article>)}</div>
              {!columnTasks.length ? <p className="grid flex-1 place-items-center py-8 text-center text-xs text-[#5f696f]">В этом разделе задач нет</p> : null}
            </section>;
          })}
        </div>
      </div>

      <aside className="grid content-start gap-4 sm:grid-cols-2 2xl:grid-cols-1">
        <section className="surface-panel p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Распределение задач</h2><CalendarDays className="size-4 text-[var(--accent)]" /></div><div className="mt-5 space-y-3">{columns.map((column) => { const count = tasks.filter((task) => task.column === column.id).length; const percent = tasks.length ? Math.max(4, Math.round(count / tasks.length * 100)) : 0; return <div key={column.id}><div className="mb-1.5 flex items-center text-[10px]"><span className="flex-1 text-[#768087]">{column.title}</span><strong style={{ color: column.tone }}>{count}</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.04]"><div className="h-full rounded-full transition-[width]" style={{ width: `${percent}%`, backgroundColor: column.tone }} /></div></div>; })}</div></section>
        <section className="surface-panel p-4"><h2 className="text-sm font-semibold text-white">Сводка</h2><dl className="mt-4 space-y-3 text-xs"><div className="flex items-center gap-3"><dt className="flex-1 text-[#768087]">Открыто сейчас</dt><dd className="font-display font-semibold text-white">{tasks.length}</dd></div><div className="flex items-center gap-3"><dt className="flex-1 text-[#768087]">Автоматических</dt><dd className="font-display font-semibold text-[var(--accent)]">{tasks.filter((task) => task.source === "visit_reminder").length}</dd></div><div className="flex items-center gap-3 border-t border-white/[0.06] pt-3"><dt className="flex-1 text-[#768087]">Выполнено за 30 дней</dt><dd className="font-display font-semibold text-[#69d3a4]">{snapshot.completedLast30Days}</dd></div></dl></section>
      </aside>
      <TaskManagementDialogs task={dialogTask} mode={dialogMode} assigneeOptions={snapshot.assigneeOptions} timeZone={snapshot.timeZone} onClose={closeDialog} />
    </div>
  );
}
