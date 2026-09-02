import { globalSearchQuerySchema } from "@/lib/global-search";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { searchPreview } from "@/server/search/preview";
import { searchGlobal } from "@/server/search/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
    if (member.role === "master") return Response.json({ error: { code: "forbidden", message: "Глобальный поиск недоступен для этой роли." } }, { status: 403, headers: privateHeaders });

    const parsedQuery = globalSearchQuerySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
    if (!parsedQuery.success) {
      return Response.json({ error: { code: "validation_error", message: parsedQuery.error.issues[0]?.message ?? "Некорректный запрос." } }, { status: 400, headers: privateHeaders });
    }

    const results = getAuthMode() === "preview"
      ? searchPreview(parsedQuery.data)
      : await searchGlobal(member, parsedQuery.data);
    return Response.json({ data: { query: parsedQuery.data, results } }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для поиска." } }, { status: 403, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "global_search.read", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Поиск временно недоступен." } }, { status: 503, headers: privateHeaders });
  }
}
