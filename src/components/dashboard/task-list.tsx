"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import type { WorkTask } from "@/lib/mock-data";

export function TaskList({ tasks }: { tasks: WorkTask[] }) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggleTask = (taskId: string) => {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  return (
    <section className="surface-panel animate-rise" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-4 2xl:py-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Задачи на сегодня</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{tasks.length - completed.size} осталось</p>
        </div>
        <Link href="/tasks" className="focus-ring rounded-lg p-2 text-[#737d83] transition-colors hover:bg-white/[0.05] hover:text-white" aria-label="Открыть задачи">
          <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <div className="divide-y divide-white/[0.055]">
        {tasks.map((task) => {
          const done = completed.has(task.id);
          return (
            <label key={task.id} className="group grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-[clamp(1rem,0.75rem+0.5vw,1.5rem)] py-3.5 transition-colors duration-200 hover:bg-white/[0.035] 2xl:py-4">
              <input type="checkbox" checked={done} onChange={() => toggleTask(task.id)} className="peer sr-only" />
              <span className="mt-0.5 grid size-[17px] place-items-center rounded-[5px] border border-white/20 text-[10px] text-transparent transition-colors peer-checked:border-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:text-[#11140b]">✓</span>
              <span className="min-w-0">
                <span className={`block truncate text-xs font-medium transition-colors ${done ? "text-[#646d72] line-through" : "text-[#e6e9e5]"}`}>{task.title}</span>
                <span className="mt-1 block truncate text-[10px] text-[#707980]">{task.meta}</span>
              </span>
              <span className={`pt-0.5 text-[10px] font-medium ${task.urgent ? "text-[var(--danger)]" : "text-[#737c82]"}`}>{task.due}</span>
            </label>
          );
        })}
      </div>
      <Link href="/tasks" className="focus-ring block border-t border-white/[0.06] px-5 py-3.5 text-center text-[11px] font-medium text-[#8d969b] transition-colors hover:bg-white/[0.03] hover:text-white">
        Все задачи
      </Link>
    </section>
  );
}
