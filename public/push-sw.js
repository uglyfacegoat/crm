self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === "object" ? parsed : {};
  } catch { /* An empty notification is still useful. */ }
  const channelId = typeof data.channelId === "string" && /^[0-9a-f-]{36}$/i.test(data.channelId) ? data.channelId : null;
  const isEvent = data.kind === "event";
  const notificationId = typeof data.notificationId === "string" && /^[0-9a-f-]{36}$/i.test(data.notificationId) ? data.notificationId : null;
  const eventUrl = typeof data.url === "string" && /^\/(?!\/)[a-zA-Z0-9/?=&%._-]*$/.test(data.url) ? data.url : "/notifications";
  const title = typeof data.title === "string" ? data.title.slice(0, 120) : isEvent ? "Новое событие · CORE" : "Новое сообщение · CORE";
  const body = typeof data.body === "string" ? data.body.slice(0, 180) : isEvent ? "Откройте CRM, чтобы посмотреть событие." : "Откройте чат, чтобы прочитать сообщение.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/app-icon-192.png",
    tag: isEvent ? notificationId ? `event-${notificationId}` : "event-new" : channelId ? `chat-${channelId}` : "chat-new-message",
    data: { url: isEvent ? eventUrl : channelId ? `/chat?channel=${encodeURIComponent(channelId)}` : "/chat" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/notifications`;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      const navigated = await existing.navigate(url);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(url);
  })());
});
