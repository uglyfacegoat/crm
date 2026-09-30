import "server-only";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { centerRecordIsAccessible } from "@/server/organizations/center-feed";

export type NoteTarget = { kind: "dashboard"; organizationId: null; id: null } |
  { kind: "order" | "client"; organizationId: string; id: string };
export type PersonalNote = { id: string; title: string; body: string; updatedAt: string };
export type NoteTemplate = { id: string; name: string; body: string; kind: "plain" | "liza_order" };
export type NoteDestination = NoteTarget & { label: string; detail?: string };

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

export type NotePage<T> = { items: T[]; total: number; nextOffset: number | null };
const notePageSize = 20;

export async function searchPersonalNotes(member: AuthenticatedMember, target: NoteTarget, query = "", offset = 0): Promise<NotePage<PersonalNote>> {
  const sql = getDatabase();
  const filter = sql`owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
    AND target_kind = ${target.kind} AND target_organization_id IS NOT DISTINCT FROM ${target.organizationId}
    AND target_id IS NOT DISTINCT FROM ${target.id}
    AND (${query} = '' OR crm_search_matches(concat_ws(' ', title, body), ${query}))`;
  const [rows, counts] = await Promise.all([
    sql`SELECT id, title, body, updated_at FROM personal_notes WHERE ${filter}
      ORDER BY updated_at DESC, id DESC LIMIT ${notePageSize} OFFSET ${offset}`,
    sql`SELECT count(*) AS total FROM personal_notes WHERE ${filter}`,
  ]);
  const total = Number(counts[0].total);
  return { items: rows.map(row => ({ id: row.id as string, title: row.title as string, body: row.body as string,
    updatedAt: (row.updated_at as Date).toISOString() })), total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
}

export async function searchPersonalNoteTemplates(member: AuthenticatedMember, query = "", offset = 0): Promise<NotePage<NoteTemplate>> {
  const sql = getDatabase();
  const filter = sql`owner_organization_id = ${member.organizationId} AND owner_member_id = ${member.memberId}
    AND (${query} = '' OR crm_search_matches(concat_ws(' ', name, body), ${query}))`;
  const [rows, counts] = await Promise.all([
    sql`SELECT id, name, body, template_kind FROM personal_note_templates WHERE ${filter}
      ORDER BY created_at DESC, id DESC LIMIT ${notePageSize} OFFSET ${offset}`,
    sql`SELECT count(*) AS total FROM personal_note_templates WHERE ${filter}`,
  ]);
  const total = Number(counts[0].total);
  return { items: rows.map(row => ({ id: row.id as string, name: row.name as string, body: row.body as string,
    kind: row.template_kind as NoteTemplate["kind"] })), total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
}

export type NoteDestinationPage = { items: NoteDestination[]; total: number; nextOffset: number | null };
const destinationPageSize = 30;

export async function searchNoteDestinations(member: AuthenticatedMember, query: string, offset = 0): Promise<NoteDestinationPage> {
  const sql = getDatabase();
  const normalizedQuery = query.trim().slice(0, 120);
  const safeOffset = Math.max(0, Math.trunc(offset));
  // Foreign orders must use the same active center grant as the final transfer.
  // Client destinations remain in the current organization, like canAccessNoteTarget.
  const matches = sql`WITH readable_order_organizations AS (
      SELECT ${member.organizationId}::uuid AS id
      UNION
      SELECT grants.target_organization_id FROM auth_sessions sessions
      JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
      JOIN organization_access_grants grants ON grants.principal_organization_id = sessions.organization_id
        AND grants.principal_member_id = sessions.member_id
      JOIN organizations company ON company.id = grants.target_organization_id AND company.organization_kind = 'company'
      JOIN organization_members target ON target.organization_id = grants.target_organization_id
        AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
      WHERE ${hasPermission(member, "companies.read")} AND sessions.id = ${member.sessionId}
        AND sessions.organization_id = ${member.organizationId} AND sessions.member_id = ${member.memberId}
        AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
    ), matches AS (
      SELECT 'order' AS kind, orders.id, orders.organization_id,
        concat('Заказ ', orders.order_number, ' · ', COALESCE(NULLIF(orders.client_name_snapshot, ''), clients.legal_name)) AS label,
        companies.name AS organization_name, orders.created_at AS updated_at,
        CASE WHEN lower(orders.order_number) = lower(${normalizedQuery}) THEN 0 ELSE 1 END AS rank
      FROM orders JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
      JOIN organizations companies ON companies.id = orders.organization_id
      WHERE ${hasPermission(member, "orders.read")} AND orders.organization_id IN (SELECT id FROM readable_order_organizations)
        AND (${normalizedQuery} = '' OR crm_search_matches(concat_ws(' ', orders.order_number,
          clients.legal_name, orders.client_name_snapshot, orders.object_name_snapshot, companies.name), ${normalizedQuery}))
      UNION ALL
      SELECT 'client', clients.id, clients.organization_id, concat('Клиент · ', clients.legal_name),
        companies.name, clients.updated_at,
        CASE WHEN lower(clients.legal_name) = lower(${normalizedQuery}) THEN 0 ELSE 1 END
      FROM clients JOIN organizations companies ON companies.id = clients.organization_id
      WHERE ${hasPermission(member, "clients.read")} AND clients.organization_id = ${member.organizationId}
        AND (${normalizedQuery} = '' OR crm_search_matches(clients.legal_name, ${normalizedQuery}))
    )`;
  const [rows, counts] = await Promise.all([
    sql`${matches} SELECT * FROM matches ORDER BY rank, updated_at DESC, kind, id DESC
      LIMIT ${destinationPageSize} OFFSET ${safeOffset}`,
    sql`${matches} SELECT count(*) AS total FROM matches`,
  ]);
  const total = Number(counts[0].total);
  const nextOffset = safeOffset + rows.length < total ? safeOffset + rows.length : null;
  return {
    items: [
      ...(safeOffset === 0 ? [{ ...dashboardNoteTarget, label: "Главная" }] : []),
      ...rows.map((row) => ({ kind: row.kind as "order" | "client", organizationId: row.organization_id as string,
        id: row.id as string, label: row.label as string,
        ...(row.organization_id !== member.organizationId ? { detail: row.organization_name as string } : {}) })),
    ],
    total: total + 1,
    nextOffset,
  };
}
