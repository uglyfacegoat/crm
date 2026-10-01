import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { DocumentNotFoundError, getDocumentPanel } from "@/server/documents/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "documents.read");
    if (getAuthMode() === "preview") throw new DocumentNotFoundError();
    const budget = await consumeRequestLimit(member, "document_detail");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: "Слишком много запросов. Повторите позже." } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await getDocumentPanel(member, (await context.params).id) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра документов." } }, { status: 403, headers });
    if (error instanceof DocumentNotFoundError) return Response.json({ error: { code: "not_found", message: "Документ недоступен." } }, { status: 404, headers });
    console.error(JSON.stringify({ operation: "documents.detail", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Карточка документа временно недоступна." } }, { status: 503, headers });
  }
}
