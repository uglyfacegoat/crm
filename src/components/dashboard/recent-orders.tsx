import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import type { OrderListItem } from "@/server/orders/types";
import { StatusBadge } from "@/components/ui/status-badge";

export function RecentOrders({ orders }: { orders: OrderListItem[] }) {
  return (
    <section className="surface-panel animate-rise" style={{ animationDelay: "360ms" }}>
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-4 sm:px-6 2xl:py-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Последние заказы</h2>
        </div>
        <Link href="/orders" className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-[#838d92] hover:text-white">Все заказы <ArrowRight className="size-3.5" /></Link>
      </div>
      <div className="hidden overflow-x-auto min-[540px]:block">
        <table className="w-full min-w-[31rem] text-left">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[#626b71]">
            <tr>
              <th className="px-6 py-3 font-medium">Заказ</th>
              <th className="px-4 py-3 font-medium">Клиент / объект</th>
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-6 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {orders.map((order) => (
              <tr key={order.id} className="group transition-colors hover:bg-white/[0.025]">
                <td className="px-6 py-4"><Link href={`/orders/${order.id}`} className="focus-ring rounded text-xs font-semibold text-white hover:text-[var(--accent)]">№{order.number}</Link></td>
                <td className="px-4 py-3.5"><p className="max-w-32 truncate text-xs font-medium text-[#dfe3df]">{order.client}</p><p className="mt-1 max-w-32 truncate text-[9px] text-[#6f787e]">{order.object}</p></td>
                <td className="px-4 py-3.5 text-[10px] text-[#90999e]">{formatShortDate(order.createdAt)}</td>
                <td className="px-4 py-3.5"><StatusBadge status={order.status} /></td>
                <td className="px-6 py-3.5 text-right font-display text-[10px] font-medium text-white">{formatMoneyMinor(order.agreedTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-white/[0.055] min-[540px]:hidden">
        {orders.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`} className="focus-ring block px-4 py-4 transition-colors hover:bg-white/[0.035] sm:px-6">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[11px] font-semibold text-white">№{order.number}</span>
                  <StatusBadge status={order.status} />
                </div>
                <p className="mt-2 truncate text-sm font-medium text-[#dfe3df]">{order.client}</p>
                <p className="mt-1 truncate text-xs text-[#6f787e]">{order.object} · {order.master ?? "Мастер не назначен"}</p>
              </div>
              <span className="shrink-0 font-display text-[11px] font-medium text-white">{formatMoneyMinor(order.agreedTotalMinor)}</span>
            </div>
          </Link>
        ))}
      </div>
      {!orders.length ? <p className="px-5 py-10 text-center text-xs text-[#69737a]">Заказов пока нет</p> : null}
    </section>
  );
}
