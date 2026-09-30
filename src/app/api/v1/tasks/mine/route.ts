import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { listMyTaskPage } from "@/server/tasks/repository";
import { myTaskPageQuerySchema } from "@/server/tasks/schemas";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "tasks.read");
    const params = new URL(request.url).searchParams;
    const parsed = myTaskPageQuerySchema.safeParse({
      q: params.get("q") ?? "", priority: params.get("priority") ?? "all",
      source: params.get("source") ?? "all", assignee: params.get("assignee") ?? "",
      dateFrom: params.get("dateFrom") ?? "", dateTo: params.get("dateTo") ?? "",
      order: params.get("order") ?? "", page: params.get("page") ?? "0",
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры списка задач." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "Список доступен только в CRM." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "global_search");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } },
      { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await listMyTaskPage(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра задач." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "tasks.mine", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Список задач временно недоступен." } }, { status: 503, headers });
  }
}
