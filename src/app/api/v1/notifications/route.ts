import { notificationQuerySchema } from "@/lib/notifications";
import { getAuthMode } from "@/server/auth/config";
import { getCurrentSession } from "@/server/auth/session";
import { getPreviewNotifications } from "@/server/notifications/preview";
import { listNotifications } from "@/server/notifications/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
  const url = new URL(request.url);
  const parsed = notificationQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    unread: url.searchParams.get("unread") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры уведомлений." } }, { status: 400, headers: privateHeaders });
  try {
    const snapshot = getAuthMode() === "preview"
      ? getPreviewNotifications(parsed.data.limit, parsed.data.unread)
      : await listNotifications(member, { limit: parsed.data.limit, unreadOnly: parsed.data.unread });
    return Response.json({ data: snapshot }, { headers: privateHeaders });
  } catch (error) {
    console.error(JSON.stringify({ operation: "notifications.list", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось загрузить уведомления." } }, { status: 503, headers: privateHeaders });
  }
}
