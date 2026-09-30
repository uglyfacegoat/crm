import "server-only";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { centerRecordIsAccessible } from "@/server/organizations/center-feed";
import { listAccessibleOrganizations } from "@/server/organizations/repository";

export type NoteTarget = { kind: "dashboard"; organizationId: null; id: null } |
  { kind: "order" | "client"; organizationId: string; id: string };
export type PersonalNote = { id: string; title: string; body: string; updatedAt: string };
export type NoteTemplate = { id: string; name: string; body: string; kind: "plain" | "liza_order" };
export type NoteDestination = NoteTarget & { label: string };

export const dashboardNoteTarget: NoteTarget = { kind: "dashboard", organizationId: null, id: null };
export function fillNoteTemplate(template: string, objectName?: string) {
  return template.replaceAll("{{object}}", objectName?.trim() || "");
}

export async function canAccessNoteTarget(member: AuthenticatedMember, target: NoteTarget) {
  if (target.kind === "dashboard") return true;
  if (!hasPermission(member, target.kind === "order" ? "orders.read" : "clients.read")) return false;
  if (target.organizationId !== member.organizationId) {
    return target.kind === "order" && hasPermission(member, "companies.read") &&
      centerRecordIsAccessible(member, "order", target.organizationId, target.id);
  }
  const sql = getDatabase();
  const table = target.kind === "order" ? "orders" : "clients";
  const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE organization_id = ${target.organizationId} AND id = ${target.id} LIMIT 1`;
  return rows.length > 0;
}

export async function listPersonalNotes(member: AuthenticatedMember, target: NoteTarget): Promise<PersonalNote[]> {
  const sql = getDatabase();
  const rows = await sql`SELECT id, title, body, updated_at FROM personal_notes
    WHERE owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
      AND target_kind = ${target.kind} AND target_organization_id IS NOT DISTINCT FROM ${target.organizationId}
      AND target_id IS NOT DISTINCT FROM ${target.id}
    ORDER BY updated_at DESC, id DESC`;
  return rows.map((row) => ({ id: row.id as string, title: row.title as string, body: row.body as string, updatedAt: (row.updated_at as Date).toISOString() }));
}

export async function listPersonalNoteTemplates(member: AuthenticatedMember): Promise<NoteTemplate[]> {
  const rows = await getDatabase()`SELECT id, name, body, template_kind FROM personal_note_templates
    WHERE owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
    ORDER BY created_at DESC`;
  return rows.map((row) => ({ id: row.id as string, name: row.name as string, body: row.body as string, kind: row.template_kind as NoteTemplate["kind"] }));
}

export async function searchNoteDestinations(member: AuthenticatedMember, query: string): Promise<NoteDestination[]> {
  const sql = getDatabase();
  const pattern = `%${query.trim().replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const accessible = hasPermission(member, "companies.read") && member.sessionId
    ? (await listAccessibleOrganizations(member)).map((org) => org.id)
    : [member.organizationId];
  const orderRows = hasPermission(member, "orders.read")
    ? await sql`SELECT orders.id, orders.organization_id, orders.order_number, clients.legal_name
        FROM orders JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
        WHERE orders.organization_id IN ${sql(accessible)}
          AND (orders.order_number ILIKE ${pattern} OR clients.legal_name ILIKE ${pattern})
        ORDER BY orders.created_at DESC LIMIT 20`
    : [];
  const clientRows = hasPermission(member, "clients.read")
    ? await sql`SELECT id, organization_id, legal_name FROM clients
        WHERE organization_id = ${member.organizationId} AND legal_name ILIKE ${pattern}
        ORDER BY updated_at DESC LIMIT 20`
    : [];
  return [dashboardNoteTargetWithLabel(),
    ...orderRows.map((row) => ({ kind: "order" as const, organizationId: row.organization_id as string, id: row.id as string, label: `Заказ ${row.order_number} · ${row.legal_name}` })),
    ...clientRows.map((row) => ({ kind: "client" as const, organizationId: row.organization_id as string, id: row.id as string, label: `Клиент · ${row.legal_name}` })),
  ];
}

function dashboardNoteTargetWithLabel(): NoteDestination {
  return { ...dashboardNoteTarget, label: "Главная" };
}
