import "server-only";
import type { NotificationSnapshot } from "@/lib/notifications";

const previewIds = {
  notification: "26f932e9-4c7b-4c1c-9f55-9aaf715c6ea8",
  visit: "a2b0ed23-63bf-472a-9835-7db83a1fc074",
  order: "3f2e6a1c-79d4-49fb-bd7a-74bd925d6df1",
};

export function getPreviewNotifications(limit: number, unreadOnly: boolean): NotificationSnapshot {
  const now = Date.now();
  const items: NotificationSnapshot["items"] = [
    {
      id: previewIds.notification,
      kind: "closing_act_overdue",
      severity: "critical",
      title: "Нет закрывающего акта",
      body: "Заказ №1246 · ООО «Вектор»\nВыезд завершился вчера в 18:20",
      sourceType: "visit",
      sourceId: previewIds.visit,
      targetType: "order",
      targetId: previewIds.order,
      href: "/orders",
      occurredAt: new Date(now - 70 * 60_000).toISOString(),
      readAt: null,
    },
    {
      id: "3071b3e7-d8ed-448b-9bfa-1571ec9d753b",
      kind: "visit_upcoming",
      severity: "info",
      title: "Выезд завтра в 09:00",
      body: "Заказ №1248 · ООО «Домжилсервис»\nул. Ленина, 15",
      sourceType: "visit",
      sourceId: "bd58ae8d-51e7-45ba-83fa-3f86bf08864d",
      targetType: "order",
      targetId: "7e8e5a5c-4fc3-45ef-8df9-cf2d18b67ca4",
      href: "/orders",
      occurredAt: new Date(now + 19 * 60 * 60_000).toISOString(),
      readAt: null,
    },
    {
      id: "2916dc24-2532-4677-987f-bf5137b9746f",
      kind: "contract_renewal",
      severity: "warning",
      title: "Пора продлить договор",
      body: "Договор №124 · ТСЖ «Пруды»\nСрок: через 12 дней",
      sourceType: "contract",
      sourceId: "cf436a80-28a1-42f6-ae3d-11690396a4e6",
      targetType: "client",
      targetId: "2d7b7262-cb0c-4214-a223-847f6bcbf27a",
      href: "/clients",
      occurredAt: new Date(now + 12 * 86_400_000).toISOString(),
      readAt: new Date(now - 2 * 60 * 60_000).toISOString(),
    },
  ];
  const visible = (unreadOnly ? items.filter((item) => item.readAt === null) : items).slice(0, limit);
  return {
    items: visible,
    unreadCount: items.filter((item) => item.readAt === null).length,
    criticalUnreadCount: items.filter((item) => item.readAt === null && item.severity === "critical").length,
    generatedAt: new Date(now).toISOString(),
  };
}
