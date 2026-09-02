import { getAuthMode } from "@/server/auth/config";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { markAllNotificationsRead } from "@/server/notifications/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403, headers: privateHeaders });
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
  try {
    const updated = getAuthMode() === "preview" ? 2 : await markAllNotificationsRead(member);
    return Response.json({ data: { updated } }, { headers: privateHeaders });
  } catch (error) {
    console.error(JSON.stringify({ operation: "notifications.read_all", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось отметить уведомления." } }, { status: 503, headers: privateHeaders });
  }
}
