"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColorAt } from "@/components/analytics/chart-colors";
import { formatMoney } from "@/lib/format";
import type { ChartSeries } from "@/server/analytics/types";

function formatChartValue(value: number, format: ChartSeries["valueFormat"]) {
  return format === "money" ? formatMoney(value) : new Intl.NumberFormat("ru-RU").format(value);
}

function formatAxisValue(value: number) {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function SiteTrafficTrendChart({ labels, series, emptyMessage }: { labels: string[]; series: ChartSeries[]; emptyMessage: string }) {
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

  return <div className="min-w-0">
    <div className="mb-5 flex flex-wrap gap-2">
      {series.map((entry, index) => {
        const visible = !hiddenSeries.has(index);
        const color = chartColorAt(index);
        return <button key={entry.label} type="button" aria-pressed={visible} onClick={() => toggleSeries(index)} className={`focus-ring flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] transition-colors ${visible ? "border-[var(--line)] bg-[var(--surface-raised)] text-[var(--text-secondary)]" : "border-transparent text-[var(--muted)]"}`}><span className="size-2 rounded-full" style={{ backgroundColor: color }} />{entry.label}</button>;
      })}
    </div>
    <div className="relative h-[clamp(18rem,21vw,24rem)] min-h-0 w-full" role="img" aria-label={`Динамика: ${series.map((entry) => entry.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
        <AreaChart data={chartData} margin={{ top: 14, right: 12, bottom: 2, left: 2 }} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 9" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={32} tick={{ fill: "var(--muted)", fontSize: 10 }} tickMargin={14} />
          {series.map((entry, index) => <YAxis key={entry.label} yAxisId={`series-${index}`} orientation={index % 2 ? "right" : "left"} hide={index > 1} axisLine={false} tickLine={false} width={52} tick={{ fill: chartColorAt(index), fontSize: 9 }} tickFormatter={formatAxisValue} domain={["auto", "auto"]} />)}
          <ReferenceLine yAxisId="series-0" y={0} stroke="var(--line-strong)" />
          <Tooltip cursor={{ stroke: "var(--accent)", strokeOpacity: 0.35, strokeWidth: 1 }} contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, boxShadow: "var(--shadow-panel)", color: "var(--text)", padding: "12px 14px" }} labelStyle={{ color: "var(--text)", fontSize: 11, fontWeight: 600, marginBottom: 8 }} itemStyle={{ color: "var(--text-secondary)", fontSize: 10, paddingTop: 2, paddingBottom: 2 }} formatter={(value, name) => [formatChartValue(Number(value), seriesByLabel.get(String(name))?.valueFormat), name]} isAnimationActive="auto" />
          {series.map((entry, index) => {
            const color = chartColorAt(index);
            return <Area key={entry.label} yAxisId={`series-${index}`} type="monotone" dataKey={`series_${index}`} name={entry.label} stroke={color} strokeWidth={2.4} strokeDasharray={index > 1 ? "5 4" : undefined} fill="none" dot={false} activeDot={{ r: 4.5, fill: "var(--surface)", stroke: color, strokeWidth: 2 }} hide={hiddenSeries.has(index)} connectNulls isAnimationActive="auto" />;
          })}
        </AreaChart>
      </ResponsiveContainer>
      {!hasValues ? <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 text-[10px] text-[var(--muted)]">{emptyMessage}</span></div> : null}
    </div>
  </div>;
}
