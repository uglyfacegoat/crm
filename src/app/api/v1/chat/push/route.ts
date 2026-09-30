import { z } from "zod";
import { getCurrentSession } from "@/server/auth/session";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { chatPushPublicKey, chatPushSubscriptionSchema, disablePushSubscription, listPushPreferences, savePushSubscription } from "@/server/chat/push";
import { safeErrorCode } from "@/server/observability/safe-error";

const headers = { "Cache-Control": "private, no-store" };

async function authorizedMember() {
  const member = await getCurrentSession();
  if (!member) return null;
  requirePermission(member, "chat.read");
  return member;
}

export async function GET() {
  try {
    const member = await authorizedMember();
    if (!member) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
    const publicKey = chatPushPublicKey();
    return publicKey ? Response.json({ publicKey, subscriptions: await listPushPreferences(member) }, { headers })
      : Response.json({ error: "push_unavailable" }, { status: 503, headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const member = await authorizedMember();
    if (!member) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
    if (!chatPushPublicKey()) return Response.json({ error: "push_unavailable" }, { status: 503, headers });
    const parsed = chatPushSubscriptionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "invalid_subscription" }, { status: 400, headers });
    await savePushSubscription(member, parsed.data, "chat");
    return Response.json({ enabled: true }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (error instanceof SyntaxError) return Response.json({ error: "invalid_subscription" }, { status: 400, headers });
    console.error(JSON.stringify({ operation: "chat.push.subscribe", errorCode: safeErrorCode(error) }));
    return Response.json({ error: "service_unavailable" }, { status: 503, headers });
  }
}

export async function DELETE(request: Request) {
  try {
    const member = await authorizedMember();
    if (!member) return Response.json({ error: "unauthenticated" }, { status: 401, headers });
    await disablePushSubscription(member, await request.json(), "chat");
    return Response.json({ enabled: false }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "invalid_subscription" }, { status: 400, headers });
    console.error(JSON.stringify({ operation: "chat.push.unsubscribe", errorCode: safeErrorCode(error) }));
    return Response.json({ error: "service_unavailable" }, { status: 503, headers });
  }
}
