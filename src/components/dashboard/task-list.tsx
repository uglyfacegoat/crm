"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTaskAction } from "@/app/(workspace)/tasks/actions";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";
import type { TaskCard } from "@/server/tasks/types";

const priorityPresentation = {
  critical: { label: "Критично", className: "bg-[var(--danger-bg)] text-[var(--danger-ink)]" },
  high: { label: "Высокий", className: "bg-[var(--warning-bg)] text-[var(--warning)]" },
  normal: { label: "Обычный", className: "bg-[var(--surface-soft)] text-[var(--text-secondary)]" },
  low: { label: "Низкий", className: "bg-[var(--support-soft)] text-[var(--support-strong)]" },
} satisfies Record<TaskCard["priority"], { label: string; className: string }>;

export function TaskList({ tasks, canWrite }: { tasks: TaskCard[]; canWrite: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  function complete(task: TaskCard) {
    if (!canWrite || pendingId) return;
    setPendingId(task.id);
    setError(null);
    startTransition(async () => {
      const result = await completeTaskAction(task.id, task.version);
      if (result.status === "error") setError(result.message);
      else router.refresh();
      setPendingId(null);
    });
  }

  return (
    <section aria-labelledby="dashboard-tasks-heading" className="surface-panel dashboard-panel animate-rise" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between border-b border-[var(--line)] px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Контроль исполнения</p>
          <h2 id="dashboard-tasks-heading" className="mt-2 text-[clamp(1rem,0.9rem+0.23vw,1.2rem)] font-semibold tracking-[-0.025em] text-[var(--text)]">Рабочая очередь</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{tasks.length ? `${tasks.length} задач в ближайшем фокусе` : "На сегодня задач нет"}</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {tasks.map((task) => {
          const priority = priorityPresentation[task.priority];
          return (
            <div key={task.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-3.5 transition-colors duration-200 hover:bg-[var(--surface-soft)]">
              <button type="button" disabled={!canWrite || pendingId !== null} onClick={() => complete(task)} aria-label={`Выполнить задачу ${task.title}`} title={canWrite ? "Отметить выполненной" : "Нет права изменять задачу"} className="focus-ring mt-0.5 grid size-[18px] place-items-center rounded-full border border-[var(--line-strong)] text-[10px] text-transparent transition-colors hover:border-[var(--accent)] hover:text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-45">✓</button>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-[var(--text-secondary)]">{task.title}</span>
                <span className="mt-1.5 flex min-w-0 items-center gap-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${priority.className}`}>{priority.label}</span><span className="truncate text-[10px] text-[var(--muted)]">{task.meta}</span></span>
              </span>
              <span className={`max-w-20 pt-0.5 text-right text-[10px] font-medium leading-4 ${task.column === "overdue" ? "text-[var(--danger-ink)]" : "text-[var(--muted)]"}`}>{pendingId === task.id ? "Сохраняем…" : task.due}</span>
            </div>
          );
        })}
      </div>
      {!tasks.length ? <p className="px-5 py-9 text-center text-xs text-[var(--muted)]">Актуальных задач нет</p> : null}
      {error ? <p role="alert" className="border-t border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-[10px] text-[var(--danger-ink)]">{error}</p> : null}
      <DashboardPanelLink href="/tasks">Открыть все задачи</DashboardPanelLink>
    </section>
  );
}
