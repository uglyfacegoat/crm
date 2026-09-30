import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/page-access";
import { requireOfficeSession } from "@/server/auth/session";
import { getDatabase } from "@/server/database";
import { centerRecordIsAccessible } from "@/server/organizations/center-feed";
import { listAccessibleOrganizations } from "@/server/organizations/repository";

const targetSchema = z.object({
  kind: z.enum(["lead", "task", "visit"]),
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
});

function readableDate(value: unknown) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow",
  }).format(date);
}

export default async function CenterRecordPage({ params, searchParams }: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ organizationId?: string }>;
}) {
  const member = await requireOfficeSession();
  requirePagePermission(member, "companies.read");
  const target = targetSchema.safeParse({ ...await params, organizationId: (await searchParams).organizationId });
  if (!target.success) notFound();
  const isCenter = (await listAccessibleOrganizations(member)).some((organization) => organization.current && organization.kind === "center");
  if (!isCenter || !(await centerRecordIsAccessible(member, target.data.kind, target.data.organizationId, target.data.id))) notFound();
  const { kind, id, organizationId } = target.data;
  const sql = getDatabase();
  const [organization] = await sql`SELECT name FROM organizations WHERE id = ${organizationId}`;
  let heading = "Запись";
  let fields: Array<[string, string]> = [];
  if (kind === "lead") {
    const [lead] = await sql`SELECT contact_name, phone, email, service_interest, object_address, comment, moderation_status, received_at
      FROM website_leads WHERE organization_id = ${organizationId} AND id = ${id}`;
    if (!lead) notFound();
    heading = String(lead.contact_name || lead.phone || "Входящая заявка");
    fields = [["Компания", String(organization.name)], ["Телефон", String(lead.phone || "—")], ["Email", String(lead.email || "—")],
      ["Услуга", String(lead.service_interest || "—")], ["Адрес", String(lead.object_address || "—")],
      ["Комментарий", String(lead.comment || "—")], ["Статус", String(lead.moderation_status)], ["Получена", readableDate(lead.received_at)]];
  } else if (kind === "task") {
    const [task] = await sql`SELECT title, description, priority, status, due_at, related_order_id
      FROM tasks WHERE organization_id = ${organizationId} AND id = ${id}`;
    if (!task) notFound();
    heading = String(task.title);
    fields = [["Компания", String(organization.name)], ["Описание", String(task.description || "—")],
      ["Приоритет", String(task.priority)], ["Статус", String(task.status)], ["Срок", readableDate(task.due_at)]];
    if (task.related_order_id) fields.push(["Заказ", String(task.related_order_id)]);
  } else {
    const [visit] = await sql`SELECT client_name_snapshot, object_name_snapshot, object_address_snapshot,
      scheduled_start_at, scheduled_end_at, status, notes, order_id
      FROM service_visits WHERE organization_id = ${organizationId} AND id = ${id}`;
    if (!visit) notFound();
    heading = String(visit.client_name_snapshot || "Выезд");
    fields = [["Компания", String(organization.name)], ["Объект", String(visit.object_name_snapshot || "—")],
      ["Адрес", String(visit.object_address_snapshot || "—")], ["Начало", readableDate(visit.scheduled_start_at)],
      ["Окончание", readableDate(visit.scheduled_end_at)], ["Статус", String(visit.status)], ["Примечание", String(visit.notes || "—")]];
    if (visit.order_id) fields.push(["Заказ", String(visit.order_id)]);
  }
  return <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/" className="back-link">← В Центр CRM</Link>
    <section className="surface-panel p-5 sm:p-7">
      <p className="eyebrow">{kind === "lead" ? "Заявка" : kind === "task" ? "Задача" : "Выезд"} · просмотр в Центре CRM</p>
      <h1 className="mt-3 break-words font-display text-2xl font-semibold text-[var(--text)]">{heading}</h1>
      <dl className="mt-6 grid gap-5 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
        {fields.map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text)]">{value}</dd></div>)}
      </dl>
    </section>
  </div>;
}
