import { getCurrentSession } from "@/server/auth/session";
import { isSameOriginRequest } from "@/server/auth/request";
import { chatPushPublicKey, chatPushSubscriptionSchema, restorePushSubscription } from "@/server/chat/push";
import { safeErrorCode } from "@/server/observability/safe-error";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "invalid_origin" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return Response.json({ error: "unsupported_media_type" }, { status: 415, headers });
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
  if (!chatPushPublicKey()) return Response.json({ error: "push_unavailable" }, { status: 503, headers });
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: "invalid_subscription" }, { status: 400, headers }); }
  const parsed = chatPushSubscriptionSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_subscription" }, { status: 400, headers });
  try {
    const preference = await restorePushSubscription(member, parsed.data);
    return Response.json({ restored: preference !== null, preference }, { headers });
  } catch (error) {
    console.error(JSON.stringify({ operation: "push.restore", errorCode: safeErrorCode(error) }));
    return Response.json({ error: "service_unavailable" }, { status: 503, headers });
  }
}
