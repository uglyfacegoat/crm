import type { Metadata } from "next";
import { CalendarWorkspace } from "@/components/calendar/calendar-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { listVisits } from "@/server/visits/repository";
import { getPreviewVisits } from "@/server/visits/preview";

export const metadata: Metadata = { title: "Календарь" };

function validAnchorDate(value: string | undefined) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))) return value;
  return new Date().toISOString().slice(0, 10);
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const member = await requireSession();
  const anchorDate = validAnchorDate((await searchParams).date);
  const anchor = new Date(`${anchorDate}T12:00:00Z`);
  const weekday = anchor.getUTCDay() || 7;
  const weekStart = new Date(anchor); weekStart.setUTCDate(anchor.getUTCDate() - weekday + 1); weekStart.setUTCHours(0, 0, 0, 0);
  const rangeStart = new Date(weekStart); rangeStart.setUTCDate(weekStart.getUTCDate() - 14);
  const rangeEnd = new Date(weekStart); rangeEnd.setUTCDate(weekStart.getUTCDate() + 21);
  const visits = getAuthMode() === "preview" ? getPreviewVisits() : await listVisits(member, rangeStart.toISOString(), rangeEnd.toISOString());
  return (
    <div>
      <PageHeading eyebrow="Планирование" title="Календарь выездов" description="Все заказы и даты выездов в одном расписании без ручных списков в комментариях." />
      <CalendarWorkspace visits={visits} anchorDate={anchorDate} canWrite={hasPermission(member.role, "visits.write")} />
    </div>
  );
}
