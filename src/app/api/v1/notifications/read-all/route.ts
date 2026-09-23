import { safeErrorCode } from "@/server/observability/safe-error";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { markAllNotificationsRead } from "@/server/notifications/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403, headers: privateHeaders });
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
  try {
    requirePermission(member, "notifications.read");
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для изменения уведомлений." } }, { status: 403, headers: privateHeaders });
    throw error;
  }
  try {
    const updated = getAuthMode() === "preview" ? 2 : await markAllNotificationsRead(member);
    return Response.json({ data: { updated } }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для изменения уведомлений." } }, { status: 403, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "notifications.read_all", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось отметить уведомления." } }, { status: 503, headers: privateHeaders });
  }
}
