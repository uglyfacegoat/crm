import { incomingLeadPickerQuerySchema } from "@/server/incoming-leads/schemas";
import { searchIncomingLeadOptions } from "@/server/incoming-leads/repository";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "leads.read");
    const url = new URL(request.url);
    const parsed = incomingLeadPickerQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? "all",
      q: url.searchParams.get("q") ?? "",
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректный поиск заявок." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "Поиск заявок недоступен в демонстрации." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "global_search");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await searchIncomingLeadOptions(member, { status: parsed.data.status, query: parsed.data.q }) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра заявок." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "inbox.options", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Поиск заявок временно недоступен." } }, { status: 503, headers });
  }
}
