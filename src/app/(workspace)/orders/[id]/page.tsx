import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, MapPin, Phone, ReceiptText, UserRound, Wrench } from "lucide-react";
import { OrderActions } from "@/components/orders/order-actions";
import { OrderRelationsSection } from "@/components/orders/order-relations-section";
import { OrderVisitSection } from "@/components/orders/order-visit-section";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatMoneyMinor, formatShortDate } from "@/lib/format";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { listOrderDocuments } from "@/server/documents/repository";
import type { DocumentListItem } from "@/server/documents/types";
import { getOrderDetail, listOrderCreationOptions, OrderNotFoundError } from "@/server/orders/repository";
import { getOrderRelations, OrderRelationNotFoundError } from "@/server/orders/relations-repository";
import { orderIdSchema } from "@/server/orders/schemas";
import { getPreviewOrderCreationOptions, getPreviewOrderDetail, getPreviewOrderRelations } from "@/server/orders/preview";
import type { OrderCreationOptions, OrderRelations } from "@/server/orders/types";
import { listOrderVisits } from "@/server/visits/repository";
import { getPreviewOrderVisits } from "@/server/visits/preview";
import type { ServiceVisit } from "@/server/visits/types";

export const metadata: Metadata = { title: "Карточка заказа" };

function InfoField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-[10px] uppercase tracking-[0.12em] text-[#687178]">{label}</dt><dd className="mt-1.5 break-words text-sm text-[#e4e7e3]">{value}</dd></div>;
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireSession();
  const preview = getAuthMode() === "preview";
  const canWrite = hasPermission(member.role, "orders.write");
  const canReadVisits = hasPermission(member.role, "visits.read") && member.role !== "master";
  const canWriteVisits = hasPermission(member.role, "visits.write");
  const canReadDocuments = hasPermission(member.role, "documents.read");
  let order;
  let options: OrderCreationOptions = { clients: [], objects: [], contacts: [], masters: [] };
  let orderVisits: ServiceVisit[] = [];
  let orderRelations: OrderRelations = { groupId: null, orders: [], candidates: [] };
  let orderDocuments: DocumentListItem[] = [];
  if (preview) {
    order = getPreviewOrderDetail(id);
    options = getPreviewOrderCreationOptions();
    orderVisits = getPreviewOrderVisits(id);
    orderRelations = getPreviewOrderRelations(id);
    if (!order) notFound();
  } else {
    const parsedId = orderIdSchema.safeParse(id);
    if (!parsedId.success) notFound();
    try {
      [order, options, orderVisits, orderRelations, orderDocuments] = await Promise.all([
        getOrderDetail(member, parsedId.data),
        canWrite ? listOrderCreationOptions(member) : Promise.resolve(options),
        canReadVisits ? listOrderVisits(member, parsedId.data) : Promise.resolve(orderVisits),
        getOrderRelations(member, parsedId.data),
        canReadDocuments ? listOrderDocuments(member, parsedId.data) : Promise.resolve(orderDocuments),
      ]);
    } catch (error) {
      if (error instanceof OrderNotFoundError || error instanceof OrderRelationNotFoundError) notFound();
      throw error;
    }
  }

  const dispatchVisit = orderVisits.find((visit) => visit.statusCode !== "completed" && visit.statusCode !== "cancelled") ?? orderVisits.at(-1) ?? null;

  return <div><div className="animate-rise flex flex-col gap-5 min-[640px]:flex-row min-[640px]:items-start min-[640px]:justify-between"><div><Link href="/orders" className="focus-ring mb-4 inline-flex items-center gap-2 rounded-lg text-xs text-[#7f888e] hover:text-white"><ArrowLeft className="size-4" />К заказам</Link><div className="flex flex-wrap items-center gap-3"><h1 className="display-title text-white">Заказ {order.number}</h1><StatusBadge status={order.status} /></div><p className="mt-2 text-sm text-[var(--muted)]">Создан {formatShortDate(order.createdAt)} · {order.serviceSummary}</p></div><OrderActions order={order} options={options} canWrite={canWrite} dispatchVisitId={dispatchVisit?.id ?? null} /></div>

    <div className="mt-[clamp(1.5rem,1.1rem+0.8vw,2.25rem)] grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] 2xl:gap-5"><div className="space-y-5"><section className="surface-panel animate-rise p-[clamp(1rem,0.7rem+0.75vw,1.6rem)]" style={{ animationDelay: "80ms" }}><div className="flex min-w-0 items-start gap-4"><span className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-[var(--accent)]/10 text-[var(--accent)]"><MapPin className="size-5" /></span><div className="min-w-0"><p className="break-words text-lg font-semibold text-white">{order.client}</p><p className="mt-1 break-words text-sm leading-6 text-[#818a90]">{order.object} · {order.address}</p></div></div><dl className="mt-6 grid gap-5 border-t border-white/[0.06] pt-6 min-[480px]:grid-cols-2 lg:grid-cols-4 2xl:gap-7"><InfoField label="Сумма" value={formatMoneyMinor(order.agreedTotalMinor)} /><InfoField label="Услуги" value={order.serviceSummary} /><InfoField label="Контакт" value={order.contactName} /><InfoField label="Телефон" value={order.contactPhone} /></dl>{order.notes ? <div className="mt-6 border-t border-white/[0.06] pt-5"><p className="text-[10px] uppercase tracking-[0.12em] text-[#687178]">Внутренняя заметка</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#aab2b6]">{order.notes}</p></div> : null}</section>

      {canReadVisits || preview ? <OrderVisitSection orderId={order.id} visits={orderVisits} masters={options.masters} defaultMasterId={order.assignedMasterId} canWrite={canWriteVisits} /> : null}

      <OrderRelationsSection orderId={order.id} relations={orderRelations} canWrite={canWrite} />

      <section className="surface-panel animate-rise p-[clamp(1rem,0.7rem+0.75vw,1.6rem)]" style={{ animationDelay: "200ms" }}><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">Состав заказа</h2><span className="text-xs text-[#747d83]">{order.services.length} поз.</span></div><div className="mt-4 divide-y divide-white/[0.055]">{order.services.map((service) => <div key={service.id} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]"><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.045] text-[#929ba0]"><Wrench className="size-4" /></span><div><p className="text-sm text-[#e1e5e0]">{service.name}</p>{service.note ? <p className="mt-1 text-xs text-[#737c82]">{service.note}</p> : null}</div></div><span className="text-xs text-[#7d868c] sm:text-right">{Number(service.quantity).toLocaleString("ru-RU")} × {formatMoneyMinor(service.unitPriceMinor)}</span><span className="font-display text-xs text-white sm:text-right">{formatMoneyMinor(service.lineTotalMinor)}</span></div>)}</div></section>

      <section className="surface-panel animate-rise p-[clamp(1rem,0.7rem+0.75vw,1.6rem)]" style={{ animationDelay: "230ms" }}><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">Прямые расходы</h2><span className="font-display text-xs text-[#e0b86a]">{formatMoneyMinor(order.directExpensesMinor)}</span></div>{order.expenses.length ? <div className="mt-4 divide-y divide-white/[0.055]">{order.expenses.map((expense) => <div key={expense.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"><div><p className="text-sm text-[#dfe3df]">{expense.category}</p><p className="mt-1 text-[10px] text-[#6f787e]">{new Intl.DateTimeFormat("ru-RU").format(new Date(`${expense.occurredOn}T12:00:00`))}{expense.note ? ` · ${expense.note}` : ""}</p></div><span className="shrink-0 font-display text-xs text-[#e0b86a]">− {formatMoneyMinor(expense.amountMinor)}</span></div>)}</div> : <p className="mt-3 text-xs text-[#687279]">Расходов по заказу нет.</p>}</section></div>

    <aside className="space-y-5"><section className="surface-panel animate-rise p-5 2xl:p-6" style={{ animationDelay: "180ms" }}><div className="flex items-center gap-3"><Avatar name={order.master ?? "Не назначен"} tone={order.master ? "violet" : "lime"} /><div><p className="text-[10px] uppercase tracking-[0.12em] text-[#697278]">Мастер</p><p className="mt-1 text-sm font-medium text-white">{order.master ?? "Не назначен"}</p></div></div><div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4"><p className="flex items-center gap-2 text-xs text-[#90999e]"><Phone className="size-3.5" />{order.masterPhone ?? "Телефон не указан"}</p><p className="flex items-center gap-2 text-xs text-[#90999e]"><UserRound className="size-3.5" />Выплата: {order.masterPaymentMinor === null ? "не указана" : formatMoneyMinor(order.masterPaymentMinor)}</p></div></section>

      <section className="surface-panel animate-rise p-5 2xl:p-6" style={{ animationDelay: "220ms" }}><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">Экономика заказа</h2><span className="rounded-full bg-white/[0.05] px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-[#707980]">Расчёт</span></div><dl className="mt-5 space-y-3 text-xs"><div className="flex items-center justify-between gap-3"><dt className="text-[#858e94]">Согласованный чек</dt><dd className="font-display text-[11px] text-white">{formatMoneyMinor(order.agreedTotalMinor)}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-[#858e94]">Выплата мастеру</dt><dd className="font-display text-[11px] text-[#e0b86a]">− {formatMoneyMinor(order.masterPaymentMinor ?? 0)}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-[#858e94]">Прямые расходы</dt><dd className="font-display text-[11px] text-[#e0b86a]">− {formatMoneyMinor(order.directExpensesMinor)}</dd></div><div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4"><dt className="font-medium text-[#dfe3df]">Плановый остаток</dt><dd className={`font-display text-sm font-semibold ${order.projectedOperatingContributionMinor >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{formatMoneyMinor(order.projectedOperatingContributionMinor)}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-[#858e94]">Оплачено клиентом</dt><dd className="font-display text-[11px] text-white">{formatMoneyMinor(order.paidTotalMinor)}</dd></div><div className="flex items-center justify-between gap-3"><dt className="text-[#858e94]">Осталось по счетам</dt><dd className="font-display text-[11px] text-white">{formatMoneyMinor(order.outstandingInvoiceMinor)}</dd></div></dl><p className="mt-4 text-[10px] leading-4 text-[#626b71]">Без учёта налогов и постоянных расходов компании.</p></section>

      {canReadDocuments ? <section className="surface-panel animate-rise p-5 2xl:p-6" style={{ animationDelay: "260ms" }}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><ReceiptText className="size-4 text-[#778188]" /><h2 className="text-sm font-semibold text-white">Документы</h2></div><span className="text-[10px] text-[#687279]">{orderDocuments.length}</span></div>{orderDocuments.length ? <div className="mt-4 space-y-1">{orderDocuments.slice(0, 5).map((document) => <a key={document.id} href={`/api/v1/documents/${document.id}/download`} className="focus-ring flex min-h-10 items-center gap-3 rounded-[11px] px-2.5 text-xs text-[#aeb5b1] hover:bg-white/[0.04] hover:text-white"><FileText className="size-3.5 shrink-0 text-[var(--accent)]" /><span className="min-w-0 flex-1 truncate">{document.title}</span><span className="text-[9px] text-[#687279]">v{document.versionNumber}</span></a>)}</div> : <p className="mt-3 text-xs leading-5 text-[#687279]">У заказа пока нет файлов. Добавьте договор, акт, фото или карточку выезда.</p>}<Link href="/documents" className="focus-ring mt-4 inline-flex rounded-lg text-xs text-[var(--accent)] hover:underline">Открыть архив</Link></section> : null}</aside></div>
  </div>;
}
