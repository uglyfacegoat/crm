import { parseClientListSearchParams } from "@/lib/client-list";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { listClientsPage } from "@/server/clients/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "clients.read");
    const parsed = parseClientListSearchParams(new URL(request.url).searchParams);
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры списка клиентов." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации список загружается вместе со страницей." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "client_list");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await listClientsPage(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра клиентов." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "clients.list", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Список клиентов временно недоступен." } }, { status: 503, headers });
  }
}
