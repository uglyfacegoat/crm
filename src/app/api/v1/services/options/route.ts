import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, hasPermission, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { catalogPickerQuerySchema, searchCatalogPicker } from "@/server/catalog/option-picker";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { listCenterCompanyScopes } from "@/server/organizations/center-dashboard";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "orders.read");
    const url = new URL(request.url);
    const parsed = catalogPickerQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      objectId: url.searchParams.get("objectId") ?? undefined,
      id: url.searchParams.get("id") ?? undefined,
      organizationId: url.searchParams.get("organizationId") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры выбора." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации доступны только примеры." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "order_picker");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    const scope = !parsed.data.organizationId || parsed.data.organizationId === member.organizationId ? member
      : hasPermission(member, "companies.read")
        ? (await listCenterCompanyScopes(member)).find((item) => item.organizationId === parsed.data.organizationId)
        : undefined;
    if (!scope) return Response.json({ error: { code: "not_found", message: "Услуги не найдены." } }, { status: 404, headers });
    requirePermission(scope, "orders.read");
    return Response.json({ data: await searchCatalogPicker(scope, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра услуг." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "catalog_picker.search", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Выбор временно недоступен." } }, { status: 503, headers });
  }
}
