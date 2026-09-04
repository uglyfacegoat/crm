import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { formatMoneyMinor } from "@/lib/format";
import type { OrderListItem } from "@/server/orders/types";

export function FinancialSummary({ orders }: { orders: OrderListItem[] }) {
  const validOrders = orders.filter((order) => order.status !== "Отменён");
  const total = validOrders.reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const completed = validOrders.filter((order) => order.status === "Выполнен");
  const completedTotal = completed.reduce((sum, order) => sum + order.agreedTotalMinor, 0);
  const values = validOrders.slice().reverse().map((order) => order.agreedTotalMinor / 100);
  const metrics = [
    { label: "Согласовано", value: formatMoneyMinor(total), change: `${validOrders.length} заказов`, color: "#91e9ce", values },
    { label: "Выполненные заказы", value: formatMoneyMinor(completedTotal), change: `${completed.length} завершено`, color: "#91e9ce", values: completed.map((order) => order.agreedTotalMinor / 100) },
    { label: "Средний чек", value: formatMoneyMinor(validOrders.length ? Math.round(total / validOrders.length) : 0), change: "за текущий месяц", color: "#b8f7e4", values },
    { label: "Доля завершённых", value: `${validOrders.length ? Math.round(completed.length / validOrders.length * 100) : 0}%`, change: "по количеству", color: "#ef646a", values: validOrders.map((order, index) => validOrders.slice(0, index + 1).filter((entry) => entry.status === "Выполнен").length) },
  ];
  return (
    <section className="surface-panel animate-rise min-w-0" style={{ animationDelay: "460ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4"><h2 className="text-sm font-semibold text-white">Финансовая сводка</h2><span className="text-[10px] text-[#707b81]">Текущий месяц</span></div>
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
