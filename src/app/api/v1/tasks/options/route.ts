import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { searchTaskOptions } from "@/server/tasks/repository";
import { taskPickerQuerySchema } from "@/server/tasks/schemas";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "tasks.write");
    const url = new URL(request.url);
    const parsed = taskPickerQuerySchema.safeParse({ type: url.searchParams.get("type"), q: url.searchParams.get("q") ?? "" });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры поиска." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "Поиск недоступен в демонстрации." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "order_picker");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await searchTaskOptions(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для выбора." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "tasks.options", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Поиск временно недоступен." } }, { status: 503, headers });
  }
}
