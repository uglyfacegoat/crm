import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

const uuid = z.string().uuid();
const leadRow = z.object({
  id: uuid,
  organization_id: uuid,
  organization_name: z.string(),
  contact_name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  service_interest: z.string().nullable(),
  moderation_status: z.enum(["new", "reviewing", "accepted", "rejected"]),
  received_at: z.coerce.date(),
});
const orderRow = z.object({
  id: uuid,
  organization_id: uuid,
  organization_name: z.string(),
  order_number: z.string(),
  client_name_snapshot: z.string(),
  status: z.enum(["new", "approval", "scheduled", "in_progress", "completed", "overdue", "cancelled"]),
  created_at: z.coerce.date(),
});

export type CenterLead = {
  id: string;
  organizationId: string;
  organizationName: string;
  contact: string;
  service: string;
  status: z.infer<typeof leadRow>["moderation_status"];
  receivedAt: string;
};
export type CenterOrder = {
  id: string;
  organizationId: string;
  organizationName: string;
  number: string;
  client: string;
  status: z.infer<typeof orderRow>["status"];
  createdAt: string;
};
export type CenterFeed = { leads: CenterLead[]; orders: CenterOrder[] };

export async function getCenterFeed(member: AuthenticatedMember, query: string): Promise<CenterFeed> {
  requirePermission(member, "companies.read");
  const normalizedQuery = query.trim().slice(0, 100);
  const sql = getDatabase();
  const [leadRows, orderRows] = await Promise.all([
    hasPermission(member, "leads.read") ? sql`
      WITH principal AS (
        SELECT sessions.organization_id, sessions.member_id
        FROM auth_sessions sessions
        JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
        WHERE sessions.id = ${member.sessionId} AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
      )
      SELECT leads.id, leads.organization_id, companies.name AS organization_name,
        leads.contact_name, leads.phone, leads.email, leads.service_interest,
        leads.moderation_status, leads.received_at
      FROM principal
      JOIN organization_access_grants grants
        ON grants.principal_organization_id = principal.organization_id
       AND grants.principal_member_id = principal.member_id
      JOIN organization_members target
        ON target.organization_id = grants.target_organization_id
       AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
      JOIN organizations companies
        ON companies.id = grants.target_organization_id
       AND companies.organization_kind = 'company'
      JOIN website_leads leads ON leads.organization_id = companies.id
      WHERE ${normalizedQuery} = '' OR crm_search_matches(concat_ws(' ',
        companies.name, leads.contact_name, leads.phone, leads.email, leads.service_interest), ${normalizedQuery})
      ORDER BY CASE leads.moderation_status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,
        leads.received_at DESC
      LIMIT 100` : Promise.resolve([]),
    hasPermission(member, "orders.read") ? sql`
      WITH principal AS (
        SELECT sessions.organization_id, sessions.member_id
        FROM auth_sessions sessions
        JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
        WHERE sessions.id = ${member.sessionId} AND sessions.revoked_at IS NULL AND sessions.expires_at > now()
      )
      SELECT orders.id, orders.organization_id, companies.name AS organization_name,
        orders.order_number, orders.client_name_snapshot, orders.status, orders.created_at
      FROM principal
      JOIN organization_access_grants grants
        ON grants.principal_organization_id = principal.organization_id
       AND grants.principal_member_id = principal.member_id
      JOIN organization_members target
        ON target.organization_id = grants.target_organization_id
       AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
      JOIN organizations companies
        ON companies.id = grants.target_organization_id
       AND companies.organization_kind = 'company'
      JOIN orders ON orders.organization_id = companies.id
      WHERE ${normalizedQuery} = '' OR crm_search_matches(concat_ws(' ',
        companies.name, orders.order_number, orders.client_name_snapshot, orders.object_name_snapshot), ${normalizedQuery})
      ORDER BY orders.created_at DESC
      LIMIT 100` : Promise.resolve([]),
  ]);
  return {
    leads: leadRows.map((value) => {
      const row = leadRow.parse(value);
      return {
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        contact: row.contact_name ?? row.phone ?? row.email ?? "Без имени",
        service: row.service_interest ?? "Услуга не указана",
        status: row.moderation_status,
        receivedAt: row.received_at.toISOString(),
      };
    }),
    orders: orderRows.map((value) => {
      const row = orderRow.parse(value);
      return {
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        number: row.order_number,
        client: row.client_name_snapshot,
        status: row.status,
        createdAt: row.created_at.toISOString(),
      };
    }),
  };
}

export async function centerRecordIsAccessible(
  member: AuthenticatedMember,
  kind: "lead" | "order" | "task" | "visit",
  organizationId: string,
  recordId: string,
) {
  requirePermission(member, "companies.read");
  requirePermission(member, kind === "lead" ? "leads.read" : kind === "task" ? "tasks.read" : kind === "visit" ? "visits.read" : "orders.read");
  const sql = getDatabase();
  // Records created directly in the center belong to the principal organization,
  // not to one of its company grants.
  if (organizationId === member.organizationId) {
    const table = kind === "lead" ? "website_leads" : kind === "task" ? "tasks" : kind === "visit" ? "service_visits" : "orders";
    const rows = await sql`SELECT 1 FROM ${sql(table)}
      WHERE organization_id = ${organizationId} AND id = ${recordId} LIMIT 1`;
    return rows.length > 0;
  }
  const scope = sql`
    SELECT 1 FROM auth_sessions sessions
    JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
    JOIN organization_access_grants grants
      ON grants.principal_organization_id = sessions.organization_id
     AND grants.principal_member_id = sessions.member_id
     AND grants.target_organization_id = ${organizationId}
    JOIN organizations companies
      ON companies.id = grants.target_organization_id AND companies.organization_kind = 'company'
    JOIN organization_members target
      ON target.organization_id = grants.target_organization_id
     AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
    WHERE sessions.id = ${member.sessionId} AND sessions.revoked_at IS NULL AND sessions.expires_at > now()`;
  if (kind === "lead") {
    const rows = await sql`SELECT 1 FROM website_leads
      WHERE organization_id = ${organizationId} AND id = ${recordId} AND EXISTS (${scope}) LIMIT 1`;
    return rows.length > 0;
  }
  if (kind === "task") {
    const rows = await sql`SELECT 1 FROM tasks
      WHERE organization_id = ${organizationId} AND id = ${recordId} AND EXISTS (${scope}) LIMIT 1`;
    return rows.length > 0;
  }
  if (kind === "visit") {
    const rows = await sql`SELECT 1 FROM service_visits
      WHERE organization_id = ${organizationId} AND id = ${recordId} AND EXISTS (${scope}) LIMIT 1`;
    return rows.length > 0;
  }
  const rows = await sql`SELECT 1 FROM orders
    WHERE organization_id = ${organizationId} AND id = ${recordId} AND EXISTS (${scope}) LIMIT 1`;
  return rows.length > 0;
}
