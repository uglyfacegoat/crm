"use client";

import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WebsiteSnapshot } from "@/server/sites/types";

const numberFormatter = new Intl.NumberFormat("ru-RU");

function axisMaximum(value: number) {
  if (value <= 0) return 1;
  const step = value <= 1_000 ? 100 : value <= 10_000 ? 500 : 1_000;
  return Math.ceil(value / step) * step;
}

export function SiteTrafficTrendChart({ labels, series, emptyMessage }: WebsiteSnapshot["trafficTrend"] & { emptyMessage: string }) {
  const gradientId = useId().replaceAll(":", "");
  const visitorSeries = series.find((entry) => entry.label === "Посетители") ?? series[0];
  const chartData = useMemo(() => labels.map((label, index) => ({ label, visitors: visitorSeries?.values[index] ?? null })), [labels, visitorSeries]);
  const measured = visitorSeries?.values.filter((value): value is number => value !== null) ?? [];
  const maximum = axisMaximum(Math.max(0, ...measured));
  const axisTicks = [0, maximum / 2, maximum];
  const dateTicks = labels.length ? [labels[0], labels[Math.floor((labels.length - 1) / 2)], labels.at(-1)].filter((label): label is string => Boolean(label)) : [];
  if (!measured.length) return <div className="site-traffic-chart grid min-h-0 w-full place-items-center text-center text-sm text-[var(--muted)]">{emptyMessage}</div>;
  return <div className="site-traffic-chart relative min-h-0 w-full" role="img" aria-label="Динамика уникальных посетителей сайта">
    <ResponsiveContainer width="100%" height="100%" minHeight={180}><AreaChart data={chartData} margin={{ top: 10, right: 5, bottom: 0, left: 0 }} accessibilityLayer>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dbe5fb" /><stop offset="100%" stopColor="#eef2fb" /></linearGradient></defs>
      <CartesianGrid vertical={false} stroke="#dfdfd9" />
      <XAxis dataKey="label" ticks={dateTicks} interval={0} axisLine={false} tickLine={false} tick={{ fill: "#70737b", fontSize: 10 }} tickMargin={12} />
      <YAxis domain={[0, maximum]} ticks={axisTicks} axisLine={false} tickLine={false} width={44} tick={{ fill: "#70737b", fontSize: 10 }} tickFormatter={(value) => numberFormatter.format(Number(value))} />
      <Tooltip cursor={{ stroke: "#9dbbff", strokeWidth: 1 }} content={({ active, label, payload }) => active && payload?.length ? <div className="rounded-[9px] border border-[var(--report-line)] bg-white px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.12)]"><span className="block text-[9px] text-[var(--report-muted)]">{label}</span><strong className="mt-1 block text-[11px] font-semibold text-[var(--report-dark)]">{numberFormatter.format(Number(payload[0].value))} посетителей</strong></div> : null} />
      <Area type="linear" dataKey="visitors" name="Посетители" stroke="#25272c" strokeWidth={2.5} fill={`url(#${gradientId})`} fillOpacity={1} activeDot={{ r: 4, fill: "#25272c", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
    </AreaChart></ResponsiveContainer>
  </div>;
}
