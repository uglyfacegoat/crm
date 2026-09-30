import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientAddress, isSameOriginRequest } from "@/server/auth/request";
import { shouldUseSecureSessionCookie } from "@/server/auth/config";
import { EMAIL_CHALLENGE_COOKIE_NAME } from "@/server/auth/email-otp-repository";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { verifyMemberEmailCode } from "@/server/auth/service";
import { InvalidJsonBodyError, readJsonBody, RequestBodyTooLargeError } from "@/server/http/json-body";
import { safeErrorCode } from "@/server/observability/safe-error";

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "invalid_origin" } }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: { code: "unsupported_media_type" } }, { status: 415 });
  }
  let body: unknown;
  try { body = await readJsonBody(request, 1024); }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: { code: "payload_too_large" } }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
    throw error;
  }
  const parsed = z.object({ code: z.string().regex(/^\d{7}$/) }).strict().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error" } }, { status: 422 });
  const token = request.cookies.get(EMAIL_CHALLENGE_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: { code: "challenge_expired" } }, { status: 401 });
  let session;
  try { session = await verifyMemberEmailCode({ token, code: parsed.data.code, clientAddress: getClientAddress(request.headers) }); }
  catch (error) {
    console.error(JSON.stringify({ operation: "api.auth.email_otp", category: "unexpected", errorCode: safeErrorCode(error) }));
    return NextResponse.json({ error: { code: "service_unavailable" } }, { status: 503 });
  }
  if (!session) return NextResponse.json({ error: { code: "invalid_code" } }, { status: 401 });
  const response = NextResponse.json({ data: { authenticated: true } });
  response.cookies.set(SESSION_COOKIE_NAME, session.token, { httpOnly: true, secure: shouldUseSecureSessionCookie(), sameSite: "lax", path: "/", expires: session.expiresAt });
  response.cookies.set(EMAIL_CHALLENGE_COOKIE_NAME, "", { httpOnly: true, secure: shouldUseSecureSessionCookie(), sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
