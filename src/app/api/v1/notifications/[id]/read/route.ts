import { z } from "zod";
import { getAuthMode } from "@/server/auth/config";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { markNotificationRead, NotificationNotFoundError } from "@/server/notifications/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };
const idSchema = z.string().uuid();

export async function POST(request: Request, context: RouteContext<"/api/v1/notifications/[id]/read">) {
  if (!isSameOriginRequest(request)) return Response.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403, headers: privateHeaders });
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
  const parsed = idSchema.safeParse((await context.params).id);
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректный идентификатор уведомления." } }, { status: 400, headers: privateHeaders });
  try {
    const updated = getAuthMode() === "preview" ? 1 : await markNotificationRead(member, parsed.data);
    return Response.json({ data: { updated } }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof NotificationNotFoundError) return Response.json({ error: { code: "not_found", message: "Уведомление уже недоступно." } }, { status: 404, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "notifications.read", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось отметить уведомление." } }, { status: 503, headers: privateHeaders });
  }
}
