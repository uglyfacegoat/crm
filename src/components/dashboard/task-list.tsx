"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTaskAction } from "@/app/(workspace)/tasks/actions";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";
import type { TaskCard } from "@/server/tasks/types";

const priorityLabels = { critical: "Критично", high: "Высокий", normal: "Обычный", low: "Низкий" } as const;

export function TaskList({ tasks, canWrite }: { tasks: TaskCard[]; canWrite: boolean }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const overdueCount = tasks.filter((task) => task.column === "overdue").length;
  const todayCount = tasks.filter((task) => task.column === "today").length;

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
    <section aria-labelledby="dashboard-tasks-heading" className="surface-panel dashboard-panel dashboard-task-panel animate-rise">
      <header className="dashboard-card-header">
        <div>
          <p className="dashboard-card-kicker">Контроль исполнения</p>
          <h2 id="dashboard-tasks-heading">Рабочая очередь</h2>
          <p>{tasks.length} задач в ближайшем фокусе</p>
        </div>
      </header>

      <div className="dashboard-task-tabs" aria-label="Срез рабочей очереди">
        <span data-active="true">Просроченные · {overdueCount}</span>
        <span>На сегодня · {todayCount}</span>
      </div>

      <div className="dashboard-task-cards">
        {tasks.map((task) => (
          <article key={task.id}>
            <button type="button" disabled={!canWrite || pendingId !== null} onClick={() => complete(task)} aria-label={`Выполнить задачу ${task.title}`} className="focus-ring dashboard-task-check">✓</button>
            <div>
              <h3>{task.title}</h3>
              <p>{task.meta}</p>
            </div>
            <div className="dashboard-task-meta">
              <span data-priority={task.priority}>{priorityLabels[task.priority]}</span>
              <strong>{pendingId === task.id ? "Сохраняем…" : task.due}</strong>
            </div>
            <footer>
              <span>{task.source === "manual" ? "Ручная задача" : "Подготовка к выезду"}</span>
              <Link href={task.relatedOrderId ? `/orders/${task.relatedOrderId}` : "/tasks"}>Открыть ↗</Link>
            </footer>
          </article>
        ))}
      </div>

      {!tasks.length ? <p className="dashboard-card-empty">Актуальных задач нет</p> : null}
      {error ? <p role="alert" className="dashboard-task-error">{error}</p> : null}
      <DashboardPanelLink href="/tasks" className="dashboard-task-all-link">Открыть все задачи</DashboardPanelLink>
    </section>
  );
}
