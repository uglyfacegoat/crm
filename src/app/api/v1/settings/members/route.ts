import { memberDirectoryQuerySchema } from "@/lib/member-directory";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { MemberNotFoundError, searchOrganizationMembers } from "@/server/members/repository";
import { safeErrorCode } from "@/server/observability/safe-error";
import { consumeRequestLimit } from "@/server/request-limits/repository";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers });
    requirePermission(member, "settings.write");
    const url = new URL(request.url);
    const parsed = memberDirectoryQuerySchema.safeParse({ q: url.searchParams.get("q") ?? undefined, status: url.searchParams.get("status") ?? undefined, page: url.searchParams.get("page") ?? undefined, });
    if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры поиска." } }, { status: 400, headers });
    if (getAuthMode() === "preview") return Response.json({ error: { code: "preview_only", message: "В демонстрации доступны только примеры." } }, { status: 404, headers });
    const budget = await consumeRequestLimit(member, "settings_directory");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: "Слишком много запросов. Повторите позже." } }, { status: 429, headers: { ...headers, "Retry-After": String(budget.retryAfterSeconds) } });
    return Response.json({ data: await searchOrganizationMembers(member, parsed.data) }, { headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для настройки пользователей." } }, { status: 403, headers });
    if (error instanceof MemberNotFoundError) return Response.json({ error: { code: "not_found", message: "Пользователь не найден." } }, { status: 404, headers });
    console.error(JSON.stringify({ operation: "settings.members.search", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Поиск временно недоступен. Повторите запрос." } }, { status: 503, headers });
  }
}
