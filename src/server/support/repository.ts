import "server-only";
import { z } from "zod";
import type { AuthenticatedMember } from "@/server/auth/types";
import { requirePermission } from "@/server/auth/permissions";
import { getDatabase } from "@/server/database";
import type { CreateSupportRequestInput } from "./schemas";
import type { UpdateSupportRequestStatusInput } from "./schemas";
import type {
  DeveloperSupportQueue,
  SupportCenterSnapshot,
  SupportRequestStatus,
} from "./types";

const developerRowSchema = z.object({ display_name: z.string(), email: z.string().email() });
const requestRowSchema = z.object({ id: z.string().uuid(), category: z.enum(["usability", "data", "access", "technical"]), subject: z.string(), status: z.enum(["new", "in_progress", "resolved", "closed"]), created_at: z.coerce.date() });
const developerTicketRowSchema = z.object({
  id: z.string().uuid(),
  organization_name: z.string(),
  requester_name: z.string(),
  requester_email: z.string().email(),
  category: z.enum(["usability", "data", "access", "technical"]),
  subject: z.string(),
  description: z.string(),
  status: z.enum(["new", "in_progress", "resolved", "closed"]),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  handled_by_email: z.string().email().nullable(),
  version: z.number().int().positive(),
});

export class SupportRequestLimitError extends Error {
  constructor() { super("Too many open support requests."); this.name = "SupportRequestLimitError"; }
}
export class SupportRequestNotFoundError extends Error {
  constructor() { super("The support request was not found."); this.name = "SupportRequestNotFoundError"; }
}
export class SupportRequestVersionConflictError extends Error {
  constructor() { super("The support request was changed by another developer."); this.name = "SupportRequestVersionConflictError"; }
}

export async function getSupportCenterSnapshot(member: AuthenticatedMember): Promise<SupportCenterSnapshot> {
  requirePermission(member, "help.read");
  const sql = getDatabase();
  const [developerRows, requestRows] = await Promise.all([
    sql`SELECT display_name, email FROM developer_accounts ORDER BY created_at LIMIT 5`,
    sql`SELECT id, category, subject, status, created_at FROM support_requests
      WHERE organization_id = ${member.organizationId} AND requested_by = ${member.memberId}
      ORDER BY created_at DESC LIMIT 8`,
  ]);
  return {
    developers: developerRows.map((value) => {
      const row = developerRowSchema.parse(value);
      return { name: row.display_name, email: row.email };
    }),
    requests: requestRows.map((value) => {
      const row = requestRowSchema.parse(value);
      return { id: row.id, category: row.category, subject: row.subject, status: row.status, createdAt: row.created_at.toISOString() };
    }),
  };
}

export async function getDeveloperSupportQueue(
  member: AuthenticatedMember,
): Promise<DeveloperSupportQueue> {
  requirePermission(member, "support.manage");
  const sql = getDatabase();
  const rows = await sql`SELECT support_requests.id, organizations.name AS organization_name,
      requesters.display_name AS requester_name, requesters.email AS requester_email,
      support_requests.category, support_requests.subject, support_requests.description,
      support_requests.status, support_requests.created_at, support_requests.updated_at,
      support_requests.handled_by_email, support_requests.version
    FROM support_requests
    JOIN organizations ON organizations.id = support_requests.organization_id
    JOIN organization_members requesters
      ON requesters.organization_id = support_requests.organization_id
      AND requesters.id = support_requests.requested_by
    ORDER BY
      CASE support_requests.status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
      support_requests.updated_at DESC
    LIMIT 300`;
  const tickets = rows.map((value) => {
    const row = developerTicketRowSchema.parse(value);
    return {
      id: row.id,
      organizationName: row.organization_name,
      requesterName: row.requester_name,
      requesterEmail: row.requester_email,
      category: row.category,
      subject: row.subject,
      description: row.description,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      handledByEmail: row.handled_by_email,
      version: row.version,
    };
  });
  const counts: Record<SupportRequestStatus | "all", number> = {
    all: tickets.length,
    new: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  };
  for (const ticket of tickets) counts[ticket.status] += 1;
  return { tickets, counts };
}

export async function updateSupportRequestStatus(
  member: AuthenticatedMember,
  input: UpdateSupportRequestStatusInput,
) {
  requirePermission(member, "support.manage");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existing] = await transaction`SELECT organization_id, status, version
      FROM support_requests WHERE id = ${input.requestId} FOR UPDATE`;
    if (!existing) throw new SupportRequestNotFoundError();
    const current = z.object({
      organization_id: z.string().uuid(),
      status: z.enum(["new", "in_progress", "resolved", "closed"]),
      version: z.number().int().positive(),
    }).parse(existing);
    if (current.version !== input.expectedVersion) {
      throw new SupportRequestVersionConflictError();
    }

    const [updated] = await transaction`UPDATE support_requests SET
        status = ${input.status},
        resolved_at = CASE WHEN ${input.status} IN ('resolved', 'closed') THEN COALESCE(resolved_at, now()) ELSE NULL END,
        handled_by_email = ${member.email},
        updated_at = now(),
        version = version + 1
      WHERE id = ${input.requestId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updated) throw new SupportRequestVersionConflictError();

    const [targetActor] = await transaction`SELECT id FROM organization_members
      WHERE organization_id = ${current.organization_id} AND email = ${member.email}
        AND active AND deleted_at IS NULL
      LIMIT 1`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${current.organization_id}, ${targetActor?.id ?? null}, ${member.sessionId},
        'support.request.status_update', 'support_request', ${input.requestId},
        ${transaction.json({ before: { status: current.status, version: current.version }, after: { status: input.status, version: updated.version }, developerEmail: member.email })})`;
    return z.number().int().positive().parse(updated.version);
  });
}

export async function createSupportRequest(member: AuthenticatedMember, input: CreateSupportRequestInput) {
  requirePermission(member, "support.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'support.request.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!request.length) {
      const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existing?.operation !== "support.request.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
      return z.string().uuid().parse(existing.entity_id);
    }
    const [openCount] = await transaction`SELECT count(*)::integer AS value FROM support_requests
      WHERE organization_id = ${member.organizationId} AND requested_by = ${member.memberId}
        AND status IN ('new', 'in_progress')`;
    if (z.object({ value: z.number().int().nonnegative() }).parse(openCount).value >= 10) throw new SupportRequestLimitError();
    const [created] = await transaction`INSERT INTO support_requests
      (organization_id, requested_by, category, subject, description)
      VALUES (${member.organizationId}, ${member.memberId}, ${input.category}, ${input.subject}, ${input.description})
      RETURNING id`;
    const requestId = z.string().uuid().parse(created.id);
    await transaction`UPDATE idempotency_requests SET entity_id = ${requestId}
      WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'support.request.create', 'support_request', ${requestId},
        ${transaction.json({ category: input.category, subject: input.subject, status: "new" })})`;
    return requestId;
  });
}
