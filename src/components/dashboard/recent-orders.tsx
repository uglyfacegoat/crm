import Link from "next/link";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import type { OrderListItem } from "@/server/orders/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";

export function RecentOrders({ orders }: { orders: OrderListItem[] }) {
  return (
    <section aria-labelledby="dashboard-orders-heading" className="surface-panel dashboard-panel animate-rise min-w-0" style={{ animationDelay: "360ms" }}>
      <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-4 py-4 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Поток заказов</p>
          <h2 id="dashboard-orders-heading" className="mt-2 text-[clamp(1rem,0.9rem+0.23vw,1.2rem)] font-semibold tracking-[-0.025em] text-[var(--text)]">Новые и обновлённые</h2>
        </div>
      </div>
      <div className="hidden overflow-x-auto min-[540px]:block">
        <table className="w-full min-w-[31rem] text-left">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            <tr>
              <th className="px-6 py-3 font-medium">Заказ</th>
              <th className="px-4 py-3 font-medium">Клиент / объект</th>
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-6 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-6 py-4"><Link href={`/orders/${order.id}`} className="focus-ring rounded text-xs font-semibold text-[var(--text)] hover:text-[var(--accent-ink)]">№{order.number}</Link></td>
                <td className="px-4 py-3.5"><p className="max-w-32 truncate text-xs font-medium text-[var(--text-secondary)]">{order.client}</p><p className="mt-1 max-w-32 truncate text-[9px] text-[var(--muted)]">{order.object}</p></td>
                <td className="px-4 py-3.5 text-[10px] text-[var(--muted)]">{formatShortDate(order.createdAt)}</td>
                <td className="px-4 py-3.5"><StatusBadge status={order.status} /></td>
                <td className="px-6 py-3.5 text-right font-display text-[10px] font-medium text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-[var(--line)] min-[540px]:hidden">
        {orders.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`} className="focus-ring block px-4 py-4 transition-colors hover:bg-[var(--surface-soft)] sm:px-6">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[11px] font-semibold text-[var(--text)]">№{order.number}</span>
                  <StatusBadge status={order.status} />
                </div>
                <p className="mt-2 truncate text-sm font-medium text-[var(--text-secondary)]">{order.client}</p>
                <p className="mt-1 truncate text-xs text-[var(--muted)]">{order.object} · {order.master ?? "Мастер не назначен"}</p>
              </div>
              <span className="shrink-0 font-display text-[11px] font-medium text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</span>
            </div>
          </Link>
        ))}
      </div>
      {!orders.length ? <p className="px-5 py-10 text-center text-xs text-[var(--muted)]">Заказов пока нет</p> : null}
      <DashboardPanelLink href="/orders">Все заказы</DashboardPanelLink>
    </section>
  );
}
