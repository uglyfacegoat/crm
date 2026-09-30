import { safeErrorCode } from "@/server/observability/safe-error";
import { NextResponse } from "next/server";
import { getAuthMode } from "@/server/auth/config";
import { getCurrentSession } from "@/server/auth/session";

export async function GET() {
  let session;
  try {
    session = await getCurrentSession();
  } catch (error) {
    console.error(JSON.stringify({ operation: "api.auth.session", category: "unexpected", errorCode: safeErrorCode(error) }));
    return NextResponse.json({ error: { code: "service_unavailable", message: "Не удалось проверить сессию." } }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401 });
  return NextResponse.json({ data: { memberId: session.memberId, organizationId: session.organizationId, organizationName: session.organizationName, displayName: session.displayName, email: session.email, role: session.role, mode: getAuthMode() } });
}
