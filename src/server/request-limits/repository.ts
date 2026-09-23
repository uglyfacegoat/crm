import "server-only";
import { z } from "zod";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const requestLimitPolicies = {
  global_search: { member: 120, organization: 1200, windowSeconds: 60 },
  chat_message: { member: 60, organization: 600, windowSeconds: 60 },
  chat_upload: { member: 10, organization: 100, windowSeconds: 60 },
  chat_download: { member: 300, organization: 3000, windowSeconds: 60 },
  chat_action: { member: 120, organization: 1200, windowSeconds: 60 },
  chat_read: { member: 180, organization: 1800, windowSeconds: 60 },
  analytics_export: { member: 12, organization: 120, windowSeconds: 60 },
  document_export: { member: 6, organization: 60, windowSeconds: 60 },
  document_upload: { member: 20, organization: 200, windowSeconds: 60 },
} as const;

const budgetResultSchema = z.object({
  allowed: z.boolean(),
  retry_after: z.number().int().positive(),
});

export async function consumeRequestLimit(
  member: Pick<AuthenticatedMember, "organizationId" | "memberId">,
  operation: keyof typeof requestLimitPolicies,
) {
  const sql = getDatabase();
  const policy = requestLimitPolicies[operation];

  async function consumeBudget(memberId: string | null, limit: number) {
    const [row] = await sql`
      INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
      VALUES (${member.organizationId}, ${memberId}, ${operation}, 1)
      ON CONFLICT (organization_id, member_id, operation) DO UPDATE SET
        request_count = CASE
          WHEN request_rate_limits.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second') THEN 1
          ELSE LEAST(request_rate_limits.request_count, ${limit}) + 1
        END,
        window_started_at = CASE
          WHEN request_rate_limits.window_started_at <= now() - (${policy.windowSeconds} * interval '1 second') THEN now()
          ELSE request_rate_limits.window_started_at
        END
      RETURNING request_count <= ${limit} AS allowed,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM window_started_at + (${policy.windowSeconds} * interval '1 second') - now())))::integer AS retry_after
    `;
    const result = budgetResultSchema.parse(row);
    return { allowed: result.allowed, retryAfterSeconds: result.retry_after };
  }

  // A blocked member must not keep spending the shared company budget.
  const memberBudget = await consumeBudget(member.memberId, policy.member);
  if (!memberBudget.allowed) return memberBudget;
  return consumeBudget(null, policy.organization);
}
