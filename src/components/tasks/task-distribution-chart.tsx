"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { TaskCard, TaskColumn } from "@/server/tasks/types";

const segments: Array<{ id: TaskColumn; label: string; color: string }> = [
  { id: "overdue", label: "Просроченные", color: "#ef646a" },
  { id: "today", label: "На сегодня", color: "#edf43b" },
  { id: "upcoming", label: "Ближайшие", color: "#65b7ee" },
  { id: "unscheduled", label: "Без срока", color: "#849097" },
];

export function TaskDistributionChart({ tasks }: { tasks: TaskCard[] }) {
  const data = segments.map((segment) => ({ ...segment, value: tasks.filter((task) => task.column === segment.id).length }));
  const chartData = data.some((segment) => segment.value > 0) ? data : [{ id: "empty", label: "Нет задач", color: "#273037", value: 1 }];

  return <div className="mt-4 grid items-center gap-4 min-[420px]:grid-cols-[9rem_minmax(0,1fr)] 2xl:grid-cols-1">
    <div className="relative mx-auto size-36" role="img" aria-label={`Распределение ${tasks.length} открытых задач по срокам`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={144} minHeight={144}>
        <PieChart accessibilityLayer>
          <Pie data={chartData} dataKey="value" nameKey="label" innerRadius={47} outerRadius={66} paddingAngle={tasks.length ? 3 : 0} stroke="none" isAnimationActive="auto">
            {chartData.map((entry) => <Cell key={entry.id} fill={entry.color} />)}
          </Pie>
          <Tooltip cursor={false} contentStyle={{ background: "#11191e", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, fontSize: 11 }} formatter={(value) => [`${value}`, "Задач"]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="font-display text-2xl text-white">{tasks.length}</strong><span className="block text-[9px] text-[#687279]">открыто</span></div></div>
    </div>
    <dl className="grid gap-1.5">{data.map((segment) => {
      const percent = tasks.length ? Math.round(segment.value / tasks.length * 100) : 0;
      return <div key={segment.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-white/[0.05] bg-white/[0.02] px-2.5 py-2"><span className="size-2 rounded-full" style={{ backgroundColor: segment.color }} /><dt className="truncate text-[10px] text-[#7b858b]">{segment.label}</dt><dd className="font-display text-[10px] text-white">{segment.value} <span className="text-[#59636a]">· {percent}%</span></dd></div>;
    })}</dl>
  </div>;
}
