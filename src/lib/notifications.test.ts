import assert from "node:assert/strict";
import test from "node:test";
import { notificationHref, notificationQuerySchema, notificationResponseSchema } from "./notifications.ts";

const id = "6f4916bc-34bc-4da9-a095-bca50b6c2ee5";

test("notification targets are converted to trusted internal routes", () => {
  assert.equal(notificationHref("order", id, "admin"), `/orders/${id}`);
  assert.equal(notificationHref("client", id, "accountant"), `/clients/${id}`);
  assert.equal(notificationHref("document", id, "dispatcher"), `/documents?document=${id}`);
  assert.equal(notificationHref("visit", id, "master"), "/my-visits");
});

test("notification response rejects external target links", () => {
  const response = {
    data: {
      items: [{
        id,
        kind: "visit_upcoming",
        severity: "info",
        title: "Выезд завтра",
        body: "Заказ №1250",
        sourceType: "visit",
        sourceId: id,
        targetType: "order",
        targetId: id,
        href: "https://example.com/phishing",
        occurredAt: new Date().toISOString(),
        readAt: null,
      }],
      unreadCount: 1,
      criticalUnreadCount: 0,
      generatedAt: new Date().toISOString(),
    },
  };
  assert.equal(notificationResponseSchema.safeParse(response).success, false);
});

test("notification cursor requires a valid timestamp and identifier together", () => {
  const valid = { limit: "25", unread: "false", beforeAt: "2026-09-24T12:00:00.000Z", beforeId: id };
  assert.equal(notificationQuerySchema.safeParse(valid).success, true);
  assert.equal(notificationQuerySchema.safeParse({ ...valid, beforeId: undefined }).success, false);
  assert.equal(notificationQuerySchema.safeParse({ ...valid, beforeAt: undefined }).success, false);
  assert.equal(notificationQuerySchema.safeParse({ ...valid, beforeAt: "yesterday" }).success, false);
});
