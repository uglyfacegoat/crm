import type { Metadata } from "next";
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

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const member = await requireOfficeSession();
  const query = await searchParams;
  const anchorDate = validAnchorDate(query.date);
  const initialView = validView(query.view);
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  const weekStart = new Date(anchor); weekStart.setUTCDate(anchor.getUTCDate() - weekday + 1); weekStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(weekStart); rangeStart.setUTCDate(weekStart.getUTCDate() - 45);
  const rangeEnd = new Date(weekStart); rangeEnd.setUTCDate(weekStart.getUTCDate() + 46);
  const preview = getAuthMode() === "preview";
  const [visits, orders] = preview
    ? [getPreviewVisits(), getPreviewOrders()]
    : await Promise.all([listVisits(member, rangeStart.toISOString(), rangeEnd.toISOString()), listOrdersWithoutActiveVisit(member)]);
  const scheduledOrderIds = new Set(visits.filter((visit) => visit.statusCode !== "completed" && visit.statusCode !== "cancelled").flatMap((visit) => visit.orderId ? [visit.orderId] : []));
  const unassignedOrders = preview
    ? orders.filter((order) => order.status !== "Выполнен" && order.status !== "Отменён" && !scheduledOrderIds.has(order.id))
    : orders;
  return (
    <div>
      <PageHeading eyebrow="Планирование" title="Календарь выездов" description="Все заказы и даты выездов в одном расписании без ручных списков в комментариях." />
      <CalendarWorkspace key={`${anchorDate}:${initialView}:${visits.map((visit) => `${visit.id}:${visit.version}`).join(",")}`} visits={visits} unassignedOrders={unassignedOrders} anchorDate={anchorDate} initialView={initialView} canWrite={hasPermission(member.role, "visits.write")} />
    </div>
  );
}
