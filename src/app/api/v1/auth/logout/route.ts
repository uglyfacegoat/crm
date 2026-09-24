import { safeErrorCode } from "@/server/observability/safe-error";
import { NextRequest, NextResponse } from "next/server";
import { isSameOriginRequest } from "@/server/auth/request";
import { shouldUseSecureSessionCookie } from "@/server/auth/config";
import { endSession } from "@/server/auth/service";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403 });
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  try {
    if (token) await endSession(token);
  } catch (error) {
    console.error(JSON.stringify({ operation: "api.auth.logout", category: "unexpected", errorCode: safeErrorCode(error) }));
    return NextResponse.json({ error: { code: "service_unavailable", message: "Не удалось завершить сессию." } }, { status: 503 });
  }
  const response = NextResponse.json({ data: { authenticated: false } });
  response.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, secure: shouldUseSecureSessionCookie(), sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
