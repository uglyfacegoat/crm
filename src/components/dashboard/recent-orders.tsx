import Link from "next/link";
import type { ReactNode } from "react";
import { openCenterRecordAction } from "@/app/(workspace)/companies/center-actions";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import type { OrderListItem } from "@/server/orders/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { DashboardPanelLink } from "@/components/dashboard/dashboard-panel-link";

function OrderOpenControl({ order, className, children }: { order: OrderListItem; className: string; children: ReactNode }) {
  if (!order.organizationId) return <Link href={`/orders/${order.id}`} className={className}>{children}</Link>;
  return <form action={openCenterRecordAction} className="contents">
    <input type="hidden" name="kind" value="order" />
    <input type="hidden" name="organizationId" value={order.organizationId} />
    <input type="hidden" name="recordId" value={order.id} />
    <button type="submit" className={className}>{children}</button>
  </form>;
}

export function RecentOrders({ orders }: { orders: OrderListItem[] }) {
  return (
    <section aria-labelledby="dashboard-orders-heading" className="surface-panel dashboard-panel animate-rise min-w-0" style={{ animationDelay: "360ms" }}>
      <header className="dashboard-card-header">
        <div>
          <p className="dashboard-card-kicker">Поток заказов</p>
          <h2 id="dashboard-orders-heading">Новые и обновлённые</h2>
          <p>Показаны последние {orders.length} добавленных и обновлённых заказов.</p>
        </div>
      </header>
      <div className="hidden overflow-x-auto min-[540px]:block">
        <table className="w-full min-w-[31rem] text-left">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
            <tr>
              <th className="px-6 py-3 font-medium">Заказ</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Объект</th>
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-6 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-6 py-4"><OrderOpenControl order={order} className="focus-ring rounded text-xs font-semibold text-[var(--text)] hover:text-[var(--accent-ink)]">№{order.number}</OrderOpenControl></td>
                <td className="px-4 py-3.5"><p className="max-w-32 truncate text-xs font-medium text-[var(--text-secondary)]">{order.client}</p>{order.organizationName ? <small className="text-[9px] text-[var(--muted)]">{order.organizationName}</small> : null}</td>
                <td className="px-4 py-3.5"><p className="max-w-32 truncate text-[10px] text-[var(--muted)]">{order.object}</p></td>
                <td className="px-4 py-3.5 text-[10px] text-[var(--muted)]">{formatShortDate(order.createdAt)}</td>
                <td className="px-4 py-3.5"><StatusBadge status={order.status} /></td>
                <td className="px-6 py-3.5 text-right font-display text-[10px] font-medium text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dashboard-orders-mobile min-[540px]:hidden grid-cols-[minmax(0,1fr)]">
        {orders.map((order) => (
          <OrderOpenControl key={order.id} order={order} className="dashboard-order-card focus-ring block min-w-0 w-full overflow-hidden px-4 py-4 text-left transition-colors hover:bg-[var(--surface-soft)] sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[11px] font-semibold text-[var(--text)]">№{order.number}</span>
                  <StatusBadge status={order.status} />
                </div>
                <p className="mt-2 break-words text-sm font-medium text-[var(--text-secondary)]">{order.client}</p>
                {order.organizationName ? <p className="mt-1 text-[10px] text-[var(--muted)]">{order.organizationName}</p> : null}
                <p className="mt-1 break-words text-xs text-[var(--muted)]">{order.object} · {order.master ?? "Мастер не назначен"}</p>
              </div>
              <span className="shrink-0 font-display text-[11px] font-medium text-[var(--text)]">{formatMoneyMinor(order.agreedTotalMinor)}</span>
            </div>
          </OrderOpenControl>
        ))}
      </div>
      {!orders.length ? <p className="px-5 py-10 text-center text-xs text-[var(--muted)]">Заказов пока нет</p> : null}
      <p className="dashboard-orders-note">Строка открывает заказ. Суммы не означают поступившую оплату.</p>
      <DashboardPanelLink href="/orders" className="dashboard-orders-footer">
        Все заказы
      </DashboardPanelLink>
    </section>
  );
}
