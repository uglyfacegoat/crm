import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateOrganizationInput } from "./schemas";
import type { OrganizationOption, OrganizationSummary } from "./types";

const organizationRowSchema = z.object({ id: z.string().uuid(), name: z.string(), organization_kind: z.enum(["center", "company"]) });
const countSchema = z.union([z.string(), z.bigint(), z.number()]).transform(Number).pipe(z.number().int().nonnegative());
const organizationSummaryRowSchema = organizationRowSchema.extend({
  client_count: countSchema,
  order_count: countSchema,
  active_order_count: countSchema,
  upcoming_visit_count: countSchema,
  open_task_count: countSchema,
  received_minor: countSchema,
});

export class OrganizationAccessError extends Error {
  constructor() { super("The organization is not available to this account."); this.name = "OrganizationAccessError"; }
}

export class OrganizationNameConflictError extends Error {
  constructor() { super("An organization with this name already exists in the center."); this.name = "OrganizationNameConflictError"; }
}

export async function listAccessibleOrganizations(member: AuthenticatedMember): Promise<OrganizationOption[]> {
  const rows = await getDatabase()`WITH principal AS (
      SELECT organization_id, member_id FROM auth_sessions WHERE id = ${member.sessionId} AND revoked_at IS NULL
    ), available AS (
      SELECT organizations.id, organizations.name, organizations.organization_kind
      FROM principal JOIN organizations ON organizations.id = principal.organization_id
      UNION ALL
      SELECT organizations.id, organizations.name, organizations.organization_kind
      FROM principal JOIN organization_access_grants grants
        ON grants.principal_organization_id = principal.organization_id AND grants.principal_member_id = principal.member_id
      JOIN organizations ON organizations.id = grants.target_organization_id
    )
    SELECT id, name, organization_kind FROM available
    ORDER BY CASE organization_kind WHEN 'center' THEN 0 ELSE 1 END, name`;
  return rows.map((value) => {
    const row = organizationRowSchema.parse(value);
    return { id: row.id, name: row.name, kind: row.organization_kind, current: row.id === member.organizationId };
  });
}

export async function listOrganizationSummaries(member: AuthenticatedMember): Promise<OrganizationSummary[]> {
  requirePermission(member, "settings.write");
  const rows = await getDatabase()`WITH principal AS (
      SELECT organization_id, member_id FROM auth_sessions WHERE id = ${member.sessionId} AND revoked_at IS NULL
    ), available AS (
      SELECT organizations.id, organizations.name, organizations.organization_kind
      FROM principal JOIN organizations ON organizations.id = principal.organization_id
      UNION ALL
      SELECT organizations.id, organizations.name, organizations.organization_kind
      FROM principal JOIN organization_access_grants grants
        ON grants.principal_organization_id = principal.organization_id AND grants.principal_member_id = principal.member_id
      JOIN organizations ON organizations.id = grants.target_organization_id
    )
    SELECT available.id, available.name, available.organization_kind,
      (SELECT count(*) FROM clients WHERE organization_id = available.id) AS client_count,
      (SELECT count(*) FROM orders WHERE organization_id = available.id) AS order_count,
      (SELECT count(*) FROM orders WHERE organization_id = available.id AND status NOT IN ('completed', 'cancelled')) AS active_order_count,
      (SELECT count(*) FROM service_visits WHERE organization_id = available.id AND scheduled_start_at >= now() AND status <> 'cancelled') AS upcoming_visit_count,
      (SELECT count(*) FROM tasks WHERE organization_id = available.id AND status = 'open') AS open_task_count,
      (SELECT coalesce(sum(paid_total_minor), 0) FROM orders WHERE organization_id = available.id AND status <> 'cancelled') AS received_minor
    FROM available
    ORDER BY CASE organization_kind WHEN 'center' THEN 0 ELSE 1 END, name`;
  const canReadFinance = hasPermission(member, "finance.read");
  return rows.map((value) => {
    const row = organizationSummaryRowSchema.parse(value);
    return {
      id: row.id,
      name: row.name,
      kind: row.organization_kind,
      current: row.id === member.organizationId,
      clientCount: row.client_count,
      orderCount: row.order_count,
      activeOrderCount: row.active_order_count,
      upcomingVisitCount: row.upcoming_visit_count,
      openTaskCount: row.open_task_count,
      receivedMinor: canReadFinance ? row.received_minor : null,
    };
  });
}

export async function switchActiveOrganization(member: AuthenticatedMember, organizationId: string) {
  const targetId = z.string().uuid().parse(organizationId);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [session] = await transaction`SELECT organization_id, member_id FROM auth_sessions
      WHERE id = ${member.sessionId} AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`;
    if (!session) throw new OrganizationAccessError();
    const homeOrganizationId = z.string().uuid().parse(session.organization_id);
    const homeMemberId = z.string().uuid().parse(session.member_id);
    let targetMemberId = homeMemberId;
    if (targetId !== homeOrganizationId) {
      const [grant] = await transaction`SELECT target_member_id FROM organization_access_grants
        WHERE principal_organization_id = ${homeOrganizationId} AND principal_member_id = ${homeMemberId}
          AND target_organization_id = ${targetId}`;
      if (!grant) throw new OrganizationAccessError();
      targetMemberId = z.string().uuid().parse(grant.target_member_id);
    }
    await transaction`UPDATE auth_sessions SET active_organization_id = ${targetId === homeOrganizationId ? null : targetId},
        active_member_id = ${targetId === homeOrganizationId ? null : targetMemberId}, last_seen_at = now()
      WHERE id = ${member.sessionId}`;
  });
}

export async function createOrganization(member: AuthenticatedMember, input: CreateOrganizationInput) {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [principal] = await transaction`SELECT sessions.organization_id, sessions.member_id,
          members.display_name, members.email, organizations.timezone, organizations.organization_kind
        FROM auth_sessions sessions
        JOIN organization_members members ON members.organization_id = sessions.organization_id AND members.id = sessions.member_id
        JOIN organizations ON organizations.id = sessions.organization_id
        WHERE sessions.id = ${member.sessionId} AND sessions.revoked_at IS NULL AND members.active FOR UPDATE`;
      if (!principal || principal.organization_kind !== "center") throw new OrganizationAccessError();
      const principalOrganizationId = z.string().uuid().parse(principal.organization_id);
      const principalMemberId = z.string().uuid().parse(principal.member_id);
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${principalOrganizationId}, ${input.idempotencyKey}, 'organizations.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT entity_id FROM idempotency_requests
          WHERE organization_id = ${principalOrganizationId} AND idempotency_key = ${input.idempotencyKey} AND operation = 'organizations.create'`;
        if (!existing?.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [organization] = await transaction`INSERT INTO organizations (name, timezone, organization_kind, parent_organization_id)
        VALUES (${input.name}, ${input.timezone}, 'company', ${principalOrganizationId}) RETURNING id`;
      const organizationId = z.string().uuid().parse(organization.id);
      const [shadowMember] = await transaction`INSERT INTO organization_members (organization_id, display_name, email, role)
        VALUES (${organizationId}, ${z.string().parse(principal.display_name)}, ${z.string().email().parse(principal.email)}, 'admin') RETURNING id`;
      const targetMemberId = z.string().uuid().parse(shadowMember.id);
      await transaction`INSERT INTO organization_access_grants
        (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
        VALUES (${principalOrganizationId}, ${principalMemberId}, ${organizationId}, ${targetMemberId})`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${organizationId}
        WHERE organization_id = ${principalOrganizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${principalOrganizationId}, ${principalMemberId}, ${member.sessionId}, 'organization.create', 'organization', ${organizationId},
          ${transaction.json({ name: input.name, timezone: input.timezone })})`;
      return organizationId;
    });
  } catch (error) {
    if (error && typeof error === "object" && "constraint_name" in error && error.constraint_name === "organizations_parent_name_unique_idx") {
      throw new OrganizationNameConflictError();
    }
    throw error;
  }
}
