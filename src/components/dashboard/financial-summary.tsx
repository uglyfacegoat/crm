import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";

const metrics = [
  { label: "Выручка", value: "1,25 млн ₽", change: "+18,2%", color: "#dce63c", values: [32, 44, 21, 36, 57, 42, 63, 51, 68, 74] },
  { label: "Операционный остаток", value: "742 тыс. ₽", change: "+11,4%", color: "#55d5ca", values: [24, 35, 19, 48, 41, 56, 67, 39, 44, 62] },
  { label: "Средний чек", value: "24 510 ₽", change: "+6,8%", color: "#9c82e8", values: [20, 31, 18, 42, 25, 49, 37, 61, 45, 58] },
  { label: "Конверсия в заказ", value: "31,6%", change: "+3,1 п.п.", color: "#ef646a", values: [18, 24, 21, 40, 35, 51, 44, 55, 49, 62] },
];

export function FinancialSummary() {
  return (
    <section className="surface-panel animate-rise min-w-0" style={{ animationDelay: "460ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4"><h2 className="text-sm font-semibold text-white">Финансовая сводка</h2><span className="text-[10px] text-[#707b81]">Август 2026</span></div>
      <div className="divide-y divide-white/[0.055] px-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.8fr)] items-center gap-3 py-3.5">
            <div className="min-w-0"><p className="truncate text-[10px] text-[#7b858b]">{metric.label}</p><div className="mt-1.5 flex flex-wrap items-baseline gap-2"><strong className="font-display text-[clamp(0.9rem,0.8rem+0.25vw,1.15rem)] text-white">{metric.value}</strong><span className="text-[9px] font-semibold" style={{ color: metric.color }}>{metric.change}</span></div></div>
            <Sparkline values={metric.values} color={metric.color} className="h-9 w-full" />
          </div>
        ))}
      </div>
      <Link href="/analytics" className="focus-ring flex items-center gap-2 border-t border-white/[0.06] px-4 py-3.5 text-[11px] font-semibold text-[var(--accent)]">Открыть аналитику <ArrowRight className="size-3.5" /></Link>
    </section>
  );
}
