import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { listMailPage, mailPageQuerySchema } from "@/server/mail/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "leads.read");
    const params = new URL(request.url).searchParams;
    const parsed = mailPageQuerySchema.safeParse({
      folder: params.get("folder") ?? "inbox", source: params.get("source") ?? "all",
      q: params.get("q") ?? "", page: params.get("page") ?? "0",
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректный запрос писем." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ data: { messages: [], sent: [], total: 0, counts: { inbox: 0, sent: 0 } } }, { headers });
    const budget = await consumeRequestLimit(member, "global_search");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } },
      { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await listMailPage(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра почты." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "mail.messages", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Письма временно недоступны." } }, { status: 503, headers });
  }
}
