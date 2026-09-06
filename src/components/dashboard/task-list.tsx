"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeTaskAction } from "@/app/(workspace)/tasks/actions";
import type { TaskCard } from "@/server/tasks/types";

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
    <section className="surface-panel animate-rise" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-4 2xl:py-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Задачи на сегодня</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{tasks.length} требуют внимания</p>
        </div>
        <Link href="/tasks" className="focus-ring grid size-8 place-items-center rounded-full text-[#737d83] transition-colors hover:bg-white/[0.05] hover:text-white" aria-label="Открыть задачи">
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <div className="divide-y divide-white/[0.055]">
        {tasks.map((task) => {
          return (
            <div key={task.id} className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-3.5 transition-colors duration-200 hover:bg-white/[0.035] 2xl:py-4">
              <button type="button" disabled={!canWrite || pendingId !== null} onClick={() => complete(task)} aria-label={`Выполнить задачу ${task.title}`} title={canWrite ? "Отметить выполненной" : "Нет права изменять задачу"} className="focus-ring mt-0.5 grid size-[17px] place-items-center rounded-full border border-white/20 text-[10px] text-transparent transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45">✓</button>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-[#e6e9e5]">{task.title}</span>
                <span className="mt-1 block truncate text-[10px] text-[#707980]">{task.meta}</span>
              </span>
              <span className={`pt-0.5 text-[10px] font-medium ${task.column === "overdue" ? "text-[var(--danger)]" : "text-[#737c82]"}`}>{pendingId === task.id ? "Сохраняем…" : task.due}</span>
            </div>
          );
        })}
      </div>
      {!tasks.length ? <p className="px-5 py-10 text-center text-xs text-[#69737a]">Актуальных задач нет</p> : null}
      {error ? <p role="alert" className="border-t border-[#ef646a]/15 bg-[#ef646a]/[0.035] px-5 py-3 text-[10px] text-[#d89599]">{error}</p> : null}
      <Link href="/tasks" className="focus-ring block border-t border-white/[0.06] px-5 py-3.5 text-center text-[11px] font-medium text-[#8d969b] transition-colors hover:bg-white/[0.03] hover:text-white">
        Все задачи
      </Link>
    </section>
  );
}
