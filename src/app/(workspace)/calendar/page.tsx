import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContractNotFoundError, getContract } from "@/server/contracts/repository";
import { getPreviewContracts } from "@/server/contracts/preview";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/page-access";
import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listOrdersWithoutActiveVisit } from "@/server/orders/repository";
import { getPreviewOrders } from "@/server/orders/preview";
import { listVisits } from "@/server/visits/repository";
import { getPreviewVisits } from "@/server/visits/preview";

export const metadata: Metadata = { title: "Календарь" };

function validAnchorDate(value: string | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))) return value;
  return new Date().toISOString().slice(0, 10);
}

function validView(value: string | undefined) {
  return value === "day" || value === "week" || value === "month" || value === "list" ? value : "week";
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string; order?: string; contract?: string }> }) {
  const member = await requireOfficeSession();
  requirePagePermission(member, "visits.read");
  const query = await searchParams;
  const focusedOrderId = z.string().uuid().safeParse(query.order).data ?? null;
  const preview = getAuthMode() === "preview";
  const focusedContractId = z.string().uuid().safeParse(query.contract).data ?? null;
  if (query.contract && !focusedContractId) notFound();
  let contract;
  if (focusedContractId) {
    try {
      contract = preview ? getPreviewContracts().contracts.find(item => item.id === focusedContractId) : await getContract(member, focusedContractId);
    } catch (error) { if (error instanceof ContractNotFoundError) notFound(); throw error; }
    if (!contract) notFound();
  }
  const foreignContract = !preview && contract && contract.organizationId !== member.organizationId;
  const readMember = foreignContract ? { ...member, organizationId: contract!.organizationId! } : member;
  const anchorDate = validAnchorDate(query.date);
  const initialView = validView(query.view);
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  const weekStart = new Date(anchor); weekStart.setUTCDate(anchor.getUTCDate() - weekday + 1); weekStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(weekStart); rangeStart.setUTCDate(weekStart.getUTCDate() - 45);
  const rangeEnd = new Date(weekStart); rangeEnd.setUTCDate(weekStart.getUTCDate() + 46);
  const [visits, orders] = preview
    ? [getPreviewVisits().filter((visit) => (!focusedOrderId || visit.orderId === focusedOrderId) && (!focusedContractId || visit.contractId === focusedContractId)), focusedContractId ? [] : getPreviewOrders().filter((order) => !focusedOrderId || order.id === focusedOrderId)]
    : await Promise.all([listVisits(readMember, rangeStart.toISOString(), rangeEnd.toISOString(), focusedOrderId, focusedContractId), !focusedContractId && hasPermission(member, "orders.read") ? listOrdersWithoutActiveVisit(member, focusedOrderId) : Promise.resolve([])]);
  const scheduledOrderIds = new Set(visits.filter((visit) => visit.statusCode !== "completed" && visit.statusCode !== "cancelled").flatMap((visit) => visit.orderId ? [visit.orderId] : []));
  const unassignedOrders = preview
    ? orders.filter((order) => order.status !== "Выполнен" && order.status !== "Отменён" && !scheduledOrderIds.has(order.id))
    : orders;
  return (
    <div>
      <PageHeading eyebrow="Планирование" title="Календарь выездов" description="Все заказы и даты выездов в одном расписании без ручных списков в комментариях." />
      <CalendarWorkspace key={`${anchorDate}:${initialView}:${focusedOrderId}:${focusedContractId}:${visits.map((visit) => `${visit.id}:${visit.version}`).join(",")}`} visits={visits} unassignedOrders={unassignedOrders} anchorDate={anchorDate} initialView={initialView} focusedOrderId={focusedOrderId} focusedContract={contract ? { id: contract.id, number: contract.contractNumber, company: foreignContract ? contract.organizationName : undefined } : undefined} canWrite={hasPermission(member, "visits.write") && !foreignContract} />
    </div>
  );
}
