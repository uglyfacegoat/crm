"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { TaskCard, TaskColumn } from "@/server/tasks/types";

const segments: Array<{ id: TaskColumn; label: string; color: string }> = [
  { id: "overdue", label: "Просроченные", color: "var(--danger)" },
  { id: "today", label: "На сегодня", color: "var(--warning)" },
  { id: "upcoming", label: "Ближайшие", color: "var(--support)" },
  { id: "unscheduled", label: "Без срока", color: "var(--muted-subtle)" },
];

export function TaskDistributionChart({ tasks }: { tasks: TaskCard[] }) {
  const data = segments.map((segment) => ({ ...segment, value: tasks.filter((task) => task.column === segment.id).length }));
  const chartData = data.some((segment) => segment.value > 0) ? data : [{ id: "empty", label: "Нет задач", color: "var(--surface-soft)", value: 1 }];

  return <div className="mt-4 grid items-center gap-4 min-[420px]:grid-cols-[9rem_minmax(0,1fr)] 2xl:grid-cols-1">
    <div className="relative mx-auto size-36" role="img" aria-label={`Распределение ${tasks.length} открытых задач по срокам`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={144} minHeight={144}>
        <PieChart accessibilityLayer>
          <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={47} outerRadius={66} paddingAngle={tasks.length ? 3 : 0} stroke="none" isAnimationActive="auto">
            {chartData.map((entry) => <Cell key={entry.id} fill={entry.color} />)}
          </Pie>
          <Tooltip cursor={false} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, color: "var(--text)", fontSize: 11 }} formatter={(value) => [`${value}`, "Задач"]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="font-display text-2xl text-[var(--text)]">{tasks.length}</strong><span className="block text-[9px] text-[var(--muted)]">открыто</span></div></div>
    </div>
    <dl className="grid gap-1.5">{data.map((segment) => {
      const percent = tasks.length ? Math.round(segment.value / tasks.length * 100) : 0;
      return <div key={segment.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-inset)] px-2.5 py-2"><span className="size-2 rounded-full" style={{ backgroundColor: segment.color }} /><dt className="truncate text-[10px] text-[var(--text-secondary)]">{segment.label}</dt><dd className="font-display text-[10px] text-[var(--text)]">{segment.value} <span className="text-[var(--muted)]">· {percent}%</span></dd></div>;
    })}</dl>
  </div>;
}
