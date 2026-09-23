import { safeErrorCode } from "@/server/observability/safe-error";
import { notificationQuerySchema } from "@/lib/notifications";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getPreviewNotifications } from "@/server/notifications/preview";
import { listNotifications } from "@/server/notifications/repository";

const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401, headers: privateHeaders });
  try {
    requirePermission(member, "notifications.read");
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра уведомлений." } }, { status: 403, headers: privateHeaders });
    throw error;
  }
  const url = new URL(request.url);
  const parsed = notificationQuerySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    unread: url.searchParams.get("unread") ?? undefined,
    beforeAt: url.searchParams.get("beforeAt") ?? undefined,
    beforeId: url.searchParams.get("beforeId") ?? undefined,
  });
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "Некорректные параметры уведомлений." } }, { status: 400, headers: privateHeaders });
  try {
    const snapshot = getAuthMode() === "preview"
      ? getPreviewNotifications(parsed.data.limit, parsed.data.unread)
      : await listNotifications(member, { limit: parsed.data.limit, unreadOnly: parsed.data.unread,
        cursor: parsed.data.beforeAt && parsed.data.beforeId ? { occurredAt: parsed.data.beforeAt, id: parsed.data.beforeId } : null });
    return Response.json({ data: snapshot }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра уведомлений." } }, { status: 403, headers: privateHeaders });
    console.error(JSON.stringify({ operation: "notifications.list", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось загрузить уведомления." } }, { status: 503, headers: privateHeaders });
  }
}
