"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartColorAt } from "@/components/analytics/chart-colors";

export function TrafficSourcesChart({ entries }: { entries: Array<{ label: string; value: number; amount: number }> }) {
  if (!entries.length) return <div className="grid min-h-56 place-items-center text-center text-[10px] leading-5 text-[var(--muted)]">UTM-источники появятся после приёма первых заявок.</div>;
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);

  return <div className="grid items-center gap-4 min-[440px]:grid-cols-[10rem_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[10rem_minmax(0,1fr)]">
    <div className="relative mx-auto size-40" role="img" aria-label={`Распределение ${total} заявок по источникам`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={160} minHeight={160}><PieChart accessibilityLayer><Pie data={entries} dataKey="amount" nameKey="label" innerRadius={52} outerRadius={74} paddingAngle={3} cornerRadius={5} stroke="var(--surface)" strokeWidth={2} isAnimationActive="auto">{entries.map((entry, index) => <Cell key={entry.label} fill={chartColorAt(index)} />)}</Pie><Tooltip cursor={false} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow-panel)", color: "var(--text)", fontSize: 11 }} formatter={(value) => [`${value}`, "Заявок"]} /></PieChart></ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="font-display text-2xl text-[var(--text)]">{total}</strong><span className="block text-[9px] text-[var(--muted)]">заявок</span></div></div>
    </div>
    <dl className="grid gap-1.5">{entries.map((entry, index) => <div key={entry.label} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--surface-raised)] px-2.5 py-2"><span className="size-2 rounded-full border border-[var(--line)]" style={{ backgroundColor: chartColorAt(index) }} /><dt className="truncate text-[10px] text-[var(--text-secondary)]">{entry.label}</dt><dd className="font-display text-[10px] text-[var(--text)]">{entry.amount} <span className="text-[var(--muted)]">· {entry.value}%</span></dd></div>)}</dl>
  </div>;
}
