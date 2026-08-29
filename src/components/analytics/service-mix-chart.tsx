"use client";

import { useMemo, useState } from "react";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoneyMinor } from "@/lib/format";
import type { AnalyticsSnapshot } from "@/server/analytics/types";

type ServiceEntry = AnalyticsSnapshot["serviceMix"][number];

export function ServiceMixChart({ entries }: { entries: ServiceEntry[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const chartEntries = useMemo(() => entries.map((entry) => ({ ...entry, fill: entry.color })), [entries]);
  if (!entries.length) return <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-white/[0.07] text-center text-xs text-[#69737a]">Услуги появятся после создания заказов</div>;
  const active = entries[activeIndex] ?? entries[0];

  return (
    <div className="grid items-center gap-6 min-[480px]:grid-cols-[minmax(13rem,0.8fr)_minmax(12rem,1fr)]">
      <div className="relative mx-auto h-64 w-full max-w-72">
        <ResponsiveContainer width="100%" height="100%" minWidth={208} minHeight={256}>
          <PieChart accessibilityLayer>
            <Pie data={chartEntries} dataKey="amountMinor" nameKey="label" cx="50%" cy="50%" innerRadius="61%" outerRadius="88%" paddingAngle={3} cornerRadius={7} stroke="rgba(8,13,16,0.8)" strokeWidth={2} onMouseEnter={(_, index) => setActiveIndex(index)} onClick={(_, index) => setActiveIndex(index)} isAnimationActive="auto" />
            <Tooltip formatter={(value, name) => [formatMoneyMinor(Number(value)), name]} contentStyle={{ background: "rgba(8,13,16,0.96)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.4)", fontSize: 10 }} itemStyle={{ color: "#dce0dc" }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div className="max-w-28"><strong className="block font-display text-2xl font-semibold tracking-[-0.05em] text-white">{active.percent}%</strong><span className="mt-1 block truncate text-[10px] text-[#778187]">{active.label}</span><span className="mt-1.5 block text-[9px] text-[#5f696f]">{formatMoneyMinor(active.amountMinor)}</span></div></div>
      </div>
      <div className="grid gap-1.5">
        {entries.map((entry, index) => <button key={entry.label} type="button" onPointerEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} onClick={() => setActiveIndex(index)} aria-pressed={activeIndex === index} className={`focus-ring grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors ${activeIndex === index ? "border-white/[0.09] bg-white/[0.045]" : "border-transparent hover:bg-white/[0.025]"}`}><span className="size-2.5 rounded-full shadow-[0_0_14px_currentColor]" style={{ backgroundColor: entry.color, color: entry.color }} /><span className="min-w-0 truncate text-xs text-[#a3abad]">{entry.label}</span><span className="text-right"><strong className="block font-display text-xs text-white">{entry.percent}%</strong><span className="mt-0.5 block text-[8px] text-[#657078]">{formatMoneyMinor(entry.amountMinor)}</span></span></button>)}
      </div>
    </div>
  );
}
