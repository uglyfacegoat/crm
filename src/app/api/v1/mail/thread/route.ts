import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getMailThread, mailThreadQuerySchema } from "@/server/mail/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "leads.read");
    const params = new URL(request.url).searchParams;
    const parsed = mailThreadQuerySchema.safeParse({ id: params.get("id"), folder: params.get("folder"), page: params.get("page") ?? 0 });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректный запрос переписки." } }, { status: 400, headers });
    const budget = await consumeRequestLimit(member, "global_search");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: "Слишком много запросов. Повторите позже." } },
      { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    const data = await getMailThread(member, parsed.data);
    return data ? Response.json({ data }, { headers })
      : Response.json({ error: { code: "not_found", message: "Письмо не найдено." } }, { status: 404, headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра почты." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "mail.thread", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Переписка временно недоступна." } }, { status: 503, headers });
  }
}
