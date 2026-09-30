"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WebsiteHealthSnapshot } from "@/server/sites/types";

const healthDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});
const responseTimeFormatter = new Intl.NumberFormat("ru-RU");

export function SiteHealthChart({ entries }: { entries: WebsiteHealthSnapshot[] }) {
  if (entries.length < 2) return <div className="grid min-h-56 place-items-center rounded-[14px] border border-dashed border-[var(--line)] px-6 text-center text-[10px] leading-5 text-[var(--muted)]">Для графика нужны минимум два контрольных замера.</div>;
  const data = entries.toReversed().map((entry) => ({ label: healthDateFormatter.format(new Date(entry.measuredAt)), response: entry.responseTimeMs }));
  return <div className="h-60 w-full" role="img" aria-label="Время ответа сервера по контрольным замерам"><ResponsiveContainer width="100%" height="100%" minHeight={240}><LineChart data={data} margin={{ top: 30, right: 12, bottom: 0, left: 8 }} accessibilityLayer>
    <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="4 5" />
    <XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={38} tick={{ fill: "var(--muted)", fontSize: 9 }} tickMargin={12} />
    <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "var(--muted)", fontSize: 9 }} unit=" мс" />
    <Tooltip wrapperStyle={{ zIndex: 20 }} cursor={{ stroke: "#9dbbff", strokeWidth: 1 }} content={({ active, label, payload }) => active && payload?.length ? <div role="tooltip" className="site-health-tooltip rounded-[10px] border border-[#3b3d42] bg-[#25272c] px-3 py-2 text-[11px] leading-4 text-white shadow-lg"><strong className="block font-medium">{label}</strong><span className="mt-1 block text-white">Ответ: {responseTimeFormatter.format(Number(payload[0]?.value))} мс</span></div> : null} />
    <Line type="monotone" dataKey="response" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--surface)", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
  </LineChart></ResponsiveContainer></div>;
}
