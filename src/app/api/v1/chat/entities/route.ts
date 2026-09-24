import { z } from "zod";
import { safeErrorCode } from "@/server/observability/safe-error";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { searchChatEntityOptions } from "@/server/chat/repository";
import { chatEntityTypes } from "@/server/chat/types";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const querySchema = z.object({
  type: z.enum(chatEntityTypes),
  q: z.string().trim().min(2).max(80),
});
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401, headers: privateHeaders });
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ type: url.searchParams.get("type"), q: url.searchParams.get("q") });
  if (!parsed.success) return Response.json({ error: "validation_error" }, { status: 400, headers: privateHeaders });
  try {
    requirePermission(member, "chat.read");
    if (getAuthMode() === "preview") return Response.json({ data: [] }, { headers: privateHeaders });
    const budget = await consumeRequestLimit(member, "chat_picker");
    if (!budget.allowed) return Response.json({ error: "rate_limited" }, {
      status: 429,
      headers: { ...privateHeaders, "Retry-After": String(budget.retryAfterSeconds) },
    });
    const data = await searchChatEntityOptions(member, parsed.data.type, parsed.data.q);
    return Response.json({ data }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "chat.entities.search", category: "unexpected", memberId: member.memberId, errorCode: safeErrorCode(error) }));
    return Response.json({ error: "service_unavailable" }, { status: 503, headers: privateHeaders });
  }
}
