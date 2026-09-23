import "server-only";
import type { AuthenticatedMember } from "@/server/auth/types";
import { consumeRequestLimit } from "./repository";

export async function rejectLimitedFileRead(
  member: Pick<AuthenticatedMember, "organizationId" | "memberId">,
  operation: "document_download" | "chat_download",
) {
  const budget = await consumeRequestLimit(member, operation);
  if (budget.allowed) return null;
  return Response.json({ error: "rate_limited" }, {
    status: 429,
    headers: {
      "Cache-Control": "private, no-store",
      "Retry-After": String(budget.retryAfterSeconds),
    },
  });
}
