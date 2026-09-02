import { notificationMutationResponseSchema, notificationResponseSchema, type NotificationSnapshot } from "./notifications";

function responseError(payload: unknown, fallback: string) {
  if (typeof payload !== "object" || payload === null || !("error" in payload)) return fallback;
  const error = payload.error;
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : fallback;
}

export async function fetchNotifications(options: { limit: number; unreadOnly?: boolean; signal?: AbortSignal }): Promise<NotificationSnapshot> {
  const query = new URLSearchParams({ limit: String(options.limit), unread: String(options.unreadOnly ?? false) });
  const response = await fetch(`/api/v1/notifications?${query}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: options.signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Не удалось загрузить уведомления."));
  return notificationResponseSchema.parse(payload).data;
}

async function mutateNotifications(path: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(responseError(payload, "Не удалось обновить уведомления."));
  return notificationMutationResponseSchema.parse(payload).data.updated;
}

export function markNotificationRead(notificationId: string) {
  return mutateNotifications(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`);
}

export function markAllNotificationsRead() {
  return mutateNotifications("/api/v1/notifications/read-all");
}
