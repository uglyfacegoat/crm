"use client";

import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import type { ChartSeries } from "@/server/analytics/types";

type TrendChartProps = {
  labels: string[];
  series: ChartSeries[];
  scale?: "shared" | "per-series";
  emptyMessage?: string;
};

function formatChartValue(value: number, format: ChartSeries["valueFormat"]) {
  return format === "money" ? formatMoney(value) : new Intl.NumberFormat("ru-RU").format(value);
}

function formatAxisValue(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function TrendChart({ labels, series, scale = "shared", emptyMessage = "За период финансовых операций нет" }: TrendChartProps) {
  const gradientPrefix = useId().replaceAll(":", "");
  const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(() => new Set());
  const chartData = useMemo(() => labels.map((label, index) => {
    const point: Record<string, string | number> = { label };
    series.forEach((entry, seriesIndex) => { point[`series_${seriesIndex}`] = entry.values[index] ?? 0; });
    return point;
  }), [labels, series]);
  const seriesByLabel = useMemo(() => new Map(series.map((entry) => [entry.label, entry])), [series]);
  const hasValues = series.some((entry) => entry.values.some((value) => value !== 0));

  function toggleSeries(index: number) {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else if (next.size < series.length - 1) next.add(index);
      return next;
    });
  }

  return (
    <div className="min-w-0">
      <div className="mb-5 flex flex-wrap gap-2">
        {series.map((entry, index) => {
          const visible = !hiddenSeries.has(index);
          return <button key={entry.label} type="button" aria-pressed={visible} onClick={() => toggleSeries(index)} className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] transition-colors ${visible ? "border-white/[0.08] bg-white/[0.035] text-[#aab2b5]" : "border-transparent text-[#596269]"}`}><span className="size-2 rounded-full shadow-[0_0_12px_currentColor]" style={{ backgroundColor: entry.color, color: entry.color }} />{entry.label}</button>;
        })}
      </div>

      <div className="relative h-[clamp(18rem,21vw,24rem)] min-h-0 w-full" role="img" aria-label={`Динамика: ${series.map((entry) => entry.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
          <AreaChart data={chartData} margin={{ top: 14, right: scale === "per-series" ? 12 : 2, bottom: 2, left: scale === "per-series" ? 2 : 0 }} accessibilityLayer>
            <defs>
              {series.map((entry, index) => <linearGradient key={entry.label} id={`${gradientPrefix}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={entry.color} stopOpacity={0.24} /><stop offset="62%" stopColor={entry.color} stopOpacity={0.055} /><stop offset="100%" stopColor={entry.color} stopOpacity={0} /></linearGradient>)}
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.065)" strokeDasharray="3 9" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: "#626d73", fontSize: 10 }} tickMargin={14} />
            {scale === "shared" ? <YAxis yAxisId="shared" axisLine={false} tickLine={false} width={58} tick={{ fill: "#626d73", fontSize: 10 }} tickFormatter={formatAxisValue} domain={["auto", "auto"]} /> : series.map((entry, index) => <YAxis key={entry.label} yAxisId={`series-${index}`} orientation={index % 2 ? "right" : "left"} hide={index > 1} axisLine={false} tickLine={false} width={52} tick={{ fill: entry.color, fontSize: 9 }} tickFormatter={formatAxisValue} domain={["auto", "auto"]} />)}
            <ReferenceLine yAxisId={scale === "shared" ? "shared" : "series-0"} y={0} stroke="rgba(255,255,255,0.11)" />
            <Tooltip cursor={{ stroke: "rgba(184,247,228,0.28)", strokeWidth: 1 }} contentStyle={{ background: "rgba(8,13,16,0.96)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, boxShadow: "0 22px 60px rgba(0,0,0,0.42)", padding: "12px 14px" }} labelStyle={{ color: "#f4f6f3", fontSize: 11, fontWeight: 600, marginBottom: 8 }} itemStyle={{ fontSize: 10, paddingTop: 2, paddingBottom: 2 }} formatter={(value, name) => [formatChartValue(Number(value), seriesByLabel.get(String(name))?.valueFormat), name]} isAnimationActive="auto" />
            {series.map((entry, index) => <Area key={entry.label} yAxisId={scale === "shared" ? "shared" : `series-${index}`} type="monotone" dataKey={`series_${index}`} name={entry.label} stroke={entry.color} strokeWidth={2.4} fill={`url(#${gradientPrefix}-${index})`} fillOpacity={1} dot={false} activeDot={{ r: 4.5, fill: "#202227", stroke: entry.color, strokeWidth: 2 }} hide={hiddenSeries.has(index)} connectNulls isAnimationActive="auto" />)}
          </AreaChart>
        </ResponsiveContainer>
        {!hasValues ? <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-full border border-white/[0.07] bg-[#25272c]/92 px-4 py-2 text-[10px] text-[#737d83]">{emptyMessage}</span></div> : null}
      </div>
    </div>
  );
}
