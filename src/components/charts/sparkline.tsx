"use client";

import { useId, useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

export function Sparkline({ values, color, className = "h-8 w-full" }: { values: number[]; color: string; className?: string }) {
  const gradientId = useId().replaceAll(":", "");
  const points = useMemo(() => values.map((value, index) => ({ index, value })), [values]);
  return <div aria-hidden="true" className={className}><ResponsiveContainer width="100%" height="100%" minWidth={32} minHeight={24}><AreaChart data={points} margin={{ top: 3, right: 2, bottom: 2, left: 2 }}><defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.28} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs><Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.8} fill={`url(#${gradientId})`} dot={false} activeDot={false} isAnimationActive="auto" /></AreaChart></ResponsiveContainer></div>;
}
