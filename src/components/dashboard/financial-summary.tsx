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
    { label: "Согласовано", value: formatMoneyMinor(total), change: `${validOrders.length} заказов`, color: "var(--accent)", values },
    { label: "Выполненные заказы", value: formatMoneyMinor(completedTotal), change: `${completed.length} завершено`, color: "var(--success)", values: completed.map((order) => order.agreedTotalMinor / 100) },
    { label: "Средний чек", value: formatMoneyMinor(validOrders.length ? Math.round(total / validOrders.length) : 0), change: "за текущий месяц", color: "var(--support)", values },
    { label: "Доля завершённых", value: `${validOrders.length ? Math.round(completed.length / validOrders.length * 100) : 0}%`, change: "по количеству", color: "var(--support-strong)", values: validOrders.map((order, index) => validOrders.slice(0, index + 1).filter((entry) => entry.status === "Выполнен").length) },
  ];
  return (
    <section aria-labelledby="dashboard-finance-heading" className="surface-panel dashboard-panel animate-rise min-w-0" style={{ animationDelay: "460ms" }}>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Деньги</p><h2 id="dashboard-finance-heading" className="mt-2 text-[clamp(1rem,0.9rem+0.23vw,1.2rem)] font-semibold tracking-[-0.025em] text-[var(--text)]">Финансовый пульс</h2></div><span className="pt-0.5 text-[10px] text-[var(--muted)]">Текущий месяц</span></div>
      <div className="divide-y divide-[var(--line)] px-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,0.8fr)] items-center gap-3 py-3.5">
            <div className="min-w-0"><p className="truncate text-[10px] text-[var(--muted)]">{metric.label}</p><div className="mt-1.5 flex flex-wrap items-baseline gap-2"><strong className="font-display text-[clamp(0.9rem,0.8rem+0.25vw,1.15rem)] text-[var(--text)]">{metric.value}</strong><span className="text-[9px] font-semibold" style={{ color: metric.color }}>{metric.change}</span></div></div>
            <Sparkline values={metric.values} color={metric.color} showArea={false} className="h-9 w-full" />
          </div>
        ))}
      </div>
      <Link href="/analytics" className="focus-ring flex items-center gap-2 border-t border-[var(--line)] px-4 py-3.5 text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--surface-soft)]">Открыть аналитику <ArrowRight className="size-3.5" /></Link>
    </section>
  );
}
