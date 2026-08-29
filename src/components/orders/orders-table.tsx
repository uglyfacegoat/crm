"use client";

import Link from "next/link";
import { CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList, Filter, Grid2X2, List, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import type { OrderDisplayStatus, OrderListItem } from "@/server/orders/types";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceStatCard } from "@/components/ui/workspace-stat-card";

const statusOptions: Array<OrderDisplayStatus | "Все"> = ["Все", "Новый", "В работе", "На согласовании", "Запланирован", "Выполнен", "Просрочен", "Отменён"];

export function OrdersTable({ orders }: { orders: OrderListItem[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<OrderDisplayStatus | "Все">("Все");
  const [view, setView] = useState<"list" | "grid">("list");

  const filteredOrders = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ru");
    return orders.filter((order) => {
      const matchesStatus = status === "Все" || order.status === status;
      const matchesQuery = !normalizedQuery || [order.number, order.client, order.object, order.address, order.serviceSummary]
        .some((value) => value.toLocaleLowerCase("ru").includes(normalizedQuery));
      return matchesStatus && matchesQuery;
    });
  }, [orders, query, status]);

  return (
    <div className="animate-rise" style={{ animationDelay: "100ms" }}>
      <section aria-label="Сводка заказов" className="grid gap-3 min-[430px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <WorkspaceStatCard label="Все заказы" value={String(orders.length)} note="Текущая выборка" icon={ClipboardList} color="#dce63c" />
        <WorkspaceStatCard label="Новые" value={String(orders.filter((order) => order.status === "Новый").length)} note="Ждут обработки" icon={CalendarDays} color="#9c82e8" />
        <WorkspaceStatCard label="В работе" value={String(orders.filter((order) => order.status === "В работе").length)} note="Активные работы" icon={ClipboardList} color="#58a6ff" />
        <WorkspaceStatCard label="На согласовании" value={String(orders.filter((order) => order.status === "На согласовании").length)} note="Нужен ответ" icon={Filter} color="#f59e42" />
        <WorkspaceStatCard label="Завершённые" value={String(orders.filter((order) => order.status === "Выполнен").length)} note="Закрытые заказы" icon={CheckCircle2} color="#49d49d" />
        <WorkspaceStatCard label="Просроченные" value={String(orders.filter((order) => order.status === "Просрочен").length)} note="Требуют внимания" icon={CircleAlert} color="#ef646a" />
      </section>

      <section className="surface-panel mt-4">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-3.5 min-[420px]:p-4 lg:flex-row lg:items-center lg:justify-between sm:px-5 2xl:py-5">
        <label className="soft-button flex h-10 min-w-0 items-center gap-2 rounded-[13px] px-3 sm:w-80 2xl:w-96">
          <Search className="size-4 shrink-0 text-[#707980]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#5e676d]" placeholder="Номер, клиент или адрес" />
        </label>
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2 sm:pb-0">
          <SlidersHorizontal className="mr-1 size-4 shrink-0 text-[#626b71]" />
          <details className="group relative shrink-0"><summary className="focus-ring flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-white/[0.07] bg-[#12181c] px-3 text-xs text-[#929a9f] [&::-webkit-details-marker]:hidden"><Filter className="size-3.5" />{status}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="absolute right-0 top-11 z-40 w-48 rounded-xl border border-white/[0.08] bg-[#11181c] p-1.5 shadow-2xl">{statusOptions.map((option) => <button key={option} onClick={(event) => { setStatus(option); event.currentTarget.closest("details")?.removeAttribute("open"); }} className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${status === option ? "bg-[var(--accent)] text-[#101308]" : "text-[#929ba0] hover:bg-white/[0.05] hover:text-white"}`}>{option}</button>)}</div></details>
          <button onClick={() => { setQuery(""); setStatus("Все"); }} className="focus-ring flex h-9 shrink-0 items-center gap-2 rounded-lg border border-white/[0.07] px-3 text-xs text-[#7c858b] hover:text-white"><RotateCcw className="size-3.5" />Сбросить</button>
          <div className="ml-auto flex shrink-0 rounded-lg border border-white/[0.07] p-1"><button onClick={() => setView("list")} aria-label="Список" className={`grid size-8 place-items-center rounded-md ${view === "list" ? "bg-[var(--accent)] text-[#101308]" : "text-[#707a80]"}`}><List className="size-4" /></button><button onClick={() => setView("grid")} aria-label="Карточки" className={`grid size-8 place-items-center rounded-md ${view === "grid" ? "bg-[var(--accent)] text-[#101308]" : "text-[#707a80]"}`}><Grid2X2 className="size-4" /></button></div>
        </div>
      </div>

      <div className={`${view === "list" ? "hidden lg:block" : "hidden"} overflow-x-auto`}>
        <table className="w-full min-w-[900px] text-left">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[#626b71]">
            <tr>
              <th className="px-5 py-3 font-medium">№ заказа</th>
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Объект</th>
              <th className="px-4 py-3 font-medium">Дата</th>
              <th className="px-4 py-3 font-medium">Мастер</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-5 py-3 text-right font-medium">Сумма</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filteredOrders.map((order) => (
              <tr key={order.id} className="group transition-colors hover:bg-white/[0.025]">
                <td className="px-5 py-4"><Link href={`/orders/${order.id}`} className="focus-ring rounded font-display text-[11px] font-semibold text-white transition-colors hover:text-[var(--accent)]">{order.number}</Link></td>
                <td className="px-4 py-4 text-xs font-medium text-[#dfe3df]">{order.client}</td>
                <td className="px-4 py-4"><p className="text-xs text-[#a6aeb2]">{order.object}</p><p className="mt-1 text-[10px] text-[#697278]">{order.address}</p></td>
                <td className="px-4 py-4 text-xs text-[#8c959a]">{formatShortDate(order.createdAt)}</td>
                <td className={`px-4 py-4 text-xs ${order.master ? "text-[#a6aeb2]" : "text-[var(--danger)]"}`}>{order.master ?? "Не назначен"}</td>
                <td className="px-4 py-4"><StatusBadge status={order.status} /></td>
                <td className="px-5 py-4 text-right font-display text-[11px] text-white">{formatMoneyMinor(order.agreedTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`${view === "list" ? "divide-y divide-white/[0.055] lg:hidden" : "grid gap-px bg-white/[0.055] sm:grid-cols-2 xl:grid-cols-3"}`}>
        {filteredOrders.map((order) => (
          <Link key={order.id} href={`/orders/${order.id}`} className="focus-ring block bg-[var(--surface)] p-4 transition-colors duration-200 hover:bg-white/[0.035] sm:px-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-[11px] font-semibold text-white">{order.number}</p>
                <p className="mt-2 text-sm font-medium text-[#e0e4df]">{order.client}</p>
                <p className="mt-1 text-xs text-[#747d83]">{order.object} · {order.address}</p>
              </div>
              <ChevronRight className="mt-1 size-4 text-[#596268]" />
            </div>
            <div className="mt-4 flex items-center justify-between gap-2"><StatusBadge status={order.status} /><span className="font-display text-xs text-white">{formatMoneyMinor(order.agreedTotalMinor)}</span></div>
          </Link>
        ))}
      </div>

      {filteredOrders.length === 0 ? (
        <div className="px-5 py-16 text-center"><p className="text-sm font-medium text-white">Заказы не найдены</p><p className="mt-2 text-xs text-[#747d83]">Измените запрос или сбросьте фильтр</p><button onClick={() => { setQuery(""); setStatus("Все"); }} className="focus-ring mt-4 rounded-lg bg-white/[0.07] px-3 py-2 text-xs text-white hover:bg-white/[0.1]">Сбросить фильтры</button></div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-3.5 text-[11px] text-[#747d83] sm:px-5 sm:text-xs">
        <span>Показано {filteredOrders.length} из {orders.length}</span>
        <span className="text-right">Актуальные данные</span>
      </div>
    </section>
    </div>
  );
}
