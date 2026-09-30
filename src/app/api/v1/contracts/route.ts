import { parseContractListSearchParams } from "@/lib/contract-list";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { listContractPage } from "@/server/contracts/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "contracts.read");
    const parsed = parseContractListSearchParams(new URL(request.url).searchParams);
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры списка договоров." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации список загружается вместе со страницей." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "contract_list");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: `Слишком много запросов. Повторите через ${budget.retryAfterSeconds} сек.` } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await listContractPage(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра договоров." } }, { status: 403, headers });
    console.error(JSON.stringify({ operation: "contracts.list", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Список договоров временно недоступен." } }, { status: 503, headers });
  }
}
