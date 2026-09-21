import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientAddress, isSameOriginRequest } from "@/server/auth/request";
import { shouldUseSecureSessionCookie } from "@/server/auth/config";
import { authenticateMember } from "@/server/auth/service";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { InvalidJsonBodyError, readJsonBody, RequestBodyTooLargeError } from "@/server/http/json-body";

const requestSchema = z.object({ identity: z.string(), password: z.string(), remember: z.boolean().optional().default(false) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403 });
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en").startsWith("application/json")) return NextResponse.json({ error: { code: "unsupported_media_type", message: "Ожидается JSON." } }, { status: 415 });

  let body: unknown;
  try {
    body = await readJsonBody(request, 32 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: { code: "payload_too_large", message: "Слишком большой запрос." } }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return NextResponse.json({ error: { code: "invalid_json", message: "Некорректный JSON." } }, { status: 400 });
    throw error;
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error", message: "Проверьте логин и пароль." } }, { status: 422 });

  let result;
  try {
    result = await authenticateMember({ ...parsed.data, clientAddress: getClientAddress(request.headers) });
  } catch (error) {
    console.error(JSON.stringify({ operation: "api.auth.login", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return NextResponse.json({ error: { code: "service_unavailable", message: "Сервис входа временно недоступен." } }, { status: 503 });
  }
  if (!result.ok) {
    const limited = result.reason === "rate_limited";
    return NextResponse.json({ error: { code: limited ? "rate_limited" : "invalid_credentials", message: limited ? "Слишком много попыток." : "Неверный логин или пароль." } }, { status: limited ? 429 : 401 });
  }

  const response = NextResponse.json({ data: { authenticated: true } });
  response.cookies.set(SESSION_COOKIE_NAME, result.session.token, { httpOnly: true, secure: shouldUseSecureSessionCookie(), sameSite: "lax", path: "/", expires: result.session.expiresAt });
  return response;
}
