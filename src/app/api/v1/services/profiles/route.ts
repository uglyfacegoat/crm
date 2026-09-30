import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { objectProfileQuerySchema, searchObjectServiceProfiles } from "@/server/catalog/object-service-profiles";
import { listReadableCatalogScopes } from "@/server/catalog/scopes";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "orders.read");
    const url = new URL(request.url);
    const parsed = objectProfileQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры списка объектов." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации доступны только примеры." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "order_picker");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await searchObjectServiceProfiles(await listReadableCatalogScopes(member), parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра объектов." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "object_profiles.search", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Условия объектов временно недоступны." } }, { status: 503, headers });
  }
}
