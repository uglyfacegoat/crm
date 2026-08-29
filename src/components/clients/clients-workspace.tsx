"use client";

import Link from "next/link";
import { AlertCircle, Building2, ChevronDown, ClipboardList, ContactRound, Search, UserCheck, UserRoundX } from "lucide-react";
import { useMemo, useState } from "react";
import { WorkspaceStatCard } from "@/components/ui/workspace-stat-card";
import type { Client } from "@/lib/mock-data";

export function ClientsWorkspace({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Все");
  const summary = useMemo(() => ({
    objects: clients.reduce((total, client) => total + client.objects, 0),
    orders: clients.reduce((total, client) => total + client.orders, 0),
    active: clients.filter((client) => client.orders > 0).length,
    withoutOrders: clients.filter((client) => client.orders === 0).length,
  }), [clients]);
  const filteredClients = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru");
    return clients.filter((client) => {
      const clientStatus = client.orders > 0 ? "С заказами" : "Без заказов";
      return (status === "Все" || clientStatus === status) && (!normalized || [client.name, client.contact, client.phone, client.email, client.taxId ?? ""].some((value) => value.toLocaleLowerCase("ru").includes(normalized)));
    });
  }, [clients, query, status]);

  return <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)]">
    <section className="grid gap-3 min-[440px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <WorkspaceStatCard label="Всего клиентов" value={String(clients.length)} note="В текущей организации" icon={ContactRound} color="#dce63c" />
      <WorkspaceStatCard label="С заказами" value={String(summary.active)} note="Есть история работы" icon={UserCheck} color="#79d49d" />
      <WorkspaceStatCard label="Объектов" value={String(summary.objects)} note="Связаны с клиентами" icon={Building2} color="#32c6dd" />
      <WorkspaceStatCard label="Заказов" value={String(summary.orders)} note="По всей клиентской базе" icon={ClipboardList} color="#9c82e8" />
      <WorkspaceStatCard label="Без заказов" value={String(summary.withoutOrders)} note="Нет истории заказов" icon={UserRoundX} color="#f07832" />
    </section>
    <section className="surface-panel mt-4">
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 lg:flex-row lg:items-center">
        <label className="soft-button flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 lg:max-w-md"><Search className="size-4 text-[#6d777d]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, ИНН, телефон или e-mail" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#59636a]" /></label>
        <details className="group relative"><summary className="focus-ring flex h-10 cursor-pointer list-none items-center justify-between gap-5 rounded-xl border border-white/[0.07] px-3 text-xs text-[#929ba0] [&::-webkit-details-marker]:hidden">История: {status}<ChevronDown className="size-3.5 transition-transform group-open:rotate-180" /></summary><div className="absolute right-0 top-12 z-30 w-52 rounded-xl border border-white/[0.08] bg-[#11181c] p-1.5 shadow-2xl">{["Все", "С заказами", "Без заказов"].map((option) => <button key={option} onClick={(event) => { setStatus(option); event.currentTarget.closest("details")?.removeAttribute("open"); }} className={`block w-full rounded-lg px-3 py-2 text-left text-xs ${status === option ? "bg-[var(--accent)] text-[#101308]" : "text-[#8b959b] hover:bg-white/[0.05]"}`}>{option}</button>)}</div></details>
        <button onClick={() => { setQuery(""); setStatus("Все"); }} className="focus-ring flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.07] px-3 text-xs text-[#7b858b]"><AlertCircle className="size-3.5" />Сбросить</button>
      </div>
      <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[830px] text-left"><thead className="text-[9px] uppercase tracking-[0.11em] text-[#626c72]"><tr>{["Клиент", "Основной контакт", "Телефон / e-mail", "Объектов", "Заказов", "Состояние"].map((heading) => <th key={heading} className="px-4 py-3.5 font-medium first:pl-5 last:pr-5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-white/[0.05]">{filteredClients.map((client) => <tr key={client.id} className="hover:bg-white/[0.025]">
        <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--accent)]/10 font-display text-[10px] text-[var(--accent)]">{client.name.replace(/[^А-ЯA-Z]/g, "").slice(0, 2)}</span><div><Link href={`/clients/${client.id}`} className="focus-ring rounded text-xs font-semibold text-white hover:text-[var(--accent)]">{client.name}</Link><p className="mt-1 text-[9px] text-[#707a80]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div></div></td>
        <td className="px-4 py-3.5 text-xs text-[#c8ced1]">{client.contact}</td><td className="px-4 py-3.5"><p className="text-xs text-[#a5adb1]">{client.phone}</p><p className="mt-1 text-[9px] text-[#707a80]">{client.email}</p></td><td className="px-4 py-3.5 text-center font-display text-xs text-white">{client.objects}</td><td className="px-4 py-3.5 text-center font-display text-xs text-white">{client.orders}</td><td className="px-5 py-3.5"><span className={`rounded-full px-2 py-1 text-[9px] ${client.orders > 0 ? "bg-[#49d49d]/10 text-[#64dcae]" : "bg-white/[0.05] text-[#7a848a]"}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></td>
      </tr>)}</tbody></table></div>
      <div className="grid gap-px bg-white/[0.055] sm:grid-cols-2 lg:hidden">{filteredClients.map((client) => <article key={client.id} className="bg-[var(--surface)] p-4"><div className="flex items-start justify-between gap-3"><div><h2><Link href={`/clients/${client.id}`} className="focus-ring rounded text-sm font-semibold text-white hover:text-[var(--accent)]">{client.name}</Link></h2><p className="mt-1 text-[10px] text-[#6f797f]">{client.taxId ? `ИНН ${client.taxId}` : client.kind}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[8px] ${client.orders > 0 ? "bg-[#49d49d]/10 text-[#64dcae]" : "bg-white/[0.05] text-[#7a848a]"}`}>{client.orders > 0 ? "Есть заказы" : "Без заказов"}</span></div><p className="mt-4 text-xs text-[#a1a9ad]">{client.contact}</p><p className="mt-1 text-[10px] text-[#707a80]">{client.phone} · {client.email}</p><div className="mt-4 text-[10px] text-[#788289]">{client.objects} объектов · {client.orders} заказов</div></article>)}</div>
      {filteredClients.length === 0 ? <div className="p-12 text-center text-sm text-[#7a848a]">Клиенты не найдены</div> : null}
    </section>
  </div>;
}
