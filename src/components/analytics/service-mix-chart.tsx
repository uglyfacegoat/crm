"use client";

import { useMemo, useState } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartColorAt } from "@/components/analytics/chart-colors";
import { formatMoneyMinor } from "@/lib/format";
import type { AnalyticsSnapshot } from "@/server/analytics/types";

type ServiceEntry = AnalyticsSnapshot["serviceMix"][number];

export function ServiceMixChart({ entries }: { entries: ServiceEntry[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const chartEntries = useMemo(() => entries.map((entry, index) => ({ ...entry, fill: chartColorAt(index) })), [entries]);
  if (!chartEntries.length) return <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-[var(--line)] text-center text-xs text-[var(--muted)]">Услуги появятся после создания заказов</div>;
  const active = chartEntries[activeIndex] ?? chartEntries[0];

  return (
    <div className="grid items-center gap-6 min-[480px]:grid-cols-[minmax(13rem,0.8fr)_minmax(12rem,1fr)]">
      <div className="relative mx-auto h-64 w-full max-w-72">
        <ResponsiveContainer width="100%" height="100%" minWidth={208} minHeight={256}>
          <PieChart accessibilityLayer>
            <Pie data={chartEntries} dataKey="amountMinor" nameKey="label" cx="50%" cy="50%" innerRadius="61%" outerRadius="88%" paddingAngle={3} cornerRadius={7} stroke="var(--surface)" strokeWidth={2} onMouseEnter={(_, index) => setActiveIndex(index)} onClick={(_, index) => setActiveIndex(index)} isAnimationActive="auto" />
            <Tooltip formatter={(value, name) => [formatMoneyMinor(Number(value)), name]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-panel)", color: "var(--text)", fontSize: 10 }} itemStyle={{ color: "var(--text-secondary)" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div className="max-w-28"><strong className="block font-display text-2xl font-semibold tracking-[-0.05em] text-[var(--text)]">{active.percent}%</strong><span className="mt-1 block truncate text-[10px] text-[var(--text-secondary)]">{active.label}</span><span className="mt-1.5 block text-[9px] text-[var(--muted)]">{formatMoneyMinor(active.amountMinor)}</span></div></div>
      </div>
      <div className="grid gap-1.5">
        {chartEntries.map((entry, index) => <button key={entry.label} type="button" onPointerEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)} aria-pressed={activeIndex === index} className={`focus-ring grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${activeIndex === index ? "border-[var(--line-strong)] bg-[var(--surface-raised)]" : "border-transparent hover:bg-[var(--surface-soft)]"}`}><span className="size-2.5 rounded-full" style={{ backgroundColor: entry.fill }} /><span className="min-w-0 truncate text-xs text-[var(--text-secondary)]">{entry.label}</span><span className="text-right"><strong className="block font-display text-xs text-[var(--text)]">{entry.percent}%</strong><span className="mt-0.5 block text-[8px] text-[var(--muted)]">{formatMoneyMinor(entry.amountMinor)}</span></span></button>)}
      </div>
    </div>
  );
}
