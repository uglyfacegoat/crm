import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { contractPickerQuerySchema, searchContractPicker } from "@/server/contracts/option-picker";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    const url = new URL(request.url);
    const parsed = contractPickerQuerySchema.safeParse({
      type: url.searchParams.get("type"),
      q: url.searchParams.get("q") ?? undefined,
      sourceContractId: url.searchParams.get("sourceContractId") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры выбора." } }, { status: 400, headers });
    requirePermission(member, parsed.data.type === "filter-masters" ? "contracts.read" : "contracts.write");
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации доступны только примеры." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "order_picker");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await searchContractPicker(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для работы с договорами." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "contract_picker.search", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Выбор временно недоступен." } }, { status: 503, headers });
  }
}
