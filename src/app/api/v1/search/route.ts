import { globalSearchQuerySchema } from "@/lib/global-search";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { searchPreview } from "@/server/search/preview";
import { searchGlobal } from "@/server/search/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
    requirePermission(member, "search.use");

    const parsedQuery = globalSearchQuerySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
    if (!parsedQuery.success) {
      return Response.json({ error: { code: "validation_error", message: parsedQuery.error.issues[0]?.message ?? "Некорректный запрос." } }, { status: 400, headers: privateHeaders });
    }

    const preview = getAuthMode() === "preview";
    if (!preview) {
      const budget = await consumeRequestLimit(member, "global_search");
      if (!budget.allowed) {
        return Response.json({ error: {
          code: "rate_limited",
          message: `Слишком много поисковых запросов. Повторите через ${budget.retryAfterSeconds} сек.`,
        } }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(budget.retryAfterSeconds) } });
      }
    }
    const results = preview
      ? searchPreview(parsedQuery.data)
      : await searchGlobal(member, parsedQuery.data);
    return Response.json({ data: { query: parsedQuery.data, results } }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для поиска." } }, { status: 403, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "global_search.read", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Поиск временно недоступен." } }, { status: 503, headers: privateHeaders });
  }
}
