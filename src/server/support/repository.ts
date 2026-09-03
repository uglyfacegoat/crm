import "server-only";
import { z } from "zod";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateSupportRequestInput } from "./schemas";
import type { SupportCenterSnapshot } from "./types";

const administratorRowSchema = z.object({ id: z.string().uuid(), display_name: z.string(), email: z.string().email() });
const requestRowSchema = z.object({ id: z.string().uuid(), category: z.enum(["usability", "data", "access", "technical"]), subject: z.string(), status: z.enum(["new", "in_progress", "resolved", "closed"]), created_at: z.coerce.date() });

export class SupportRequestLimitError extends Error {
  constructor() { super("Too many open support requests."); this.name = "SupportRequestLimitError"; }
}

export async function getSupportCenterSnapshot(member: AuthenticatedMember): Promise<SupportCenterSnapshot> {
  const sql = getDatabase();
  const [administratorRows, requestRows] = await Promise.all([
    sql`SELECT id, display_name, email FROM organization_members
      WHERE organization_id = ${member.organizationId} AND role = 'admin' AND active
      ORDER BY created_at LIMIT 5`,
    sql`SELECT id, category, subject, status, created_at FROM support_requests
      WHERE organization_id = ${member.organizationId} AND requested_by = ${member.memberId}
      ORDER BY created_at DESC LIMIT 8`,
  ]);
  return {
    administrators: administratorRows.map((value) => {
      const row = administratorRowSchema.parse(value);
      return { id: row.id, name: row.display_name, email: row.email };
    }),
    requests: requestRows.map((value) => {
      const row = requestRowSchema.parse(value);
      return { id: row.id, category: row.category, subject: row.subject, status: row.status, createdAt: row.created_at.toISOString() };
    }),
  };
}

export async function createSupportRequest(member: AuthenticatedMember, input: CreateSupportRequestInput) {
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
