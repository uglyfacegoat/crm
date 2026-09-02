import assert from "node:assert/strict";
import test from "node:test";
import { buildVisitHistoryFeed, mapVisitHistoryEvent } from "./history.ts";

const eventId = "11111111-1111-4111-8111-111111111111";
const visitId = "22222222-2222-4222-8222-222222222222";

test("visit history normalizes persisted timestamps and cancellation details", () => {
  const event = mapVisitHistoryEvent({
    id: eventId,
    visit_id: visitId,
    event_type: "status_changed",
    actor_name: "Ирина Власова",
    reason: "Клиент перенёс обработку",
    before_state: { scheduledStartAt: "2026-08-31T07:00:00+00:00", status: "confirmed" },
    after_state: { scheduledStartAt: "2026-09-02T09:30:00+00:00", status: "cancelled", cancellationReason: "Клиент перенёс обработку" },
    created_at: "2026-08-30T12:15:00+00:00",
    total_count: 1,
  });

  assert.equal(event.beforeState?.scheduledStartAt, "2026-08-31T07:00:00.000Z");
  assert.equal(event.afterState.status, "cancelled");
  assert.equal(event.afterState.cancellationReason, "Клиент перенёс обработку");
  assert.equal(event.actorName, "Ирина Власова");
});

test("visit history exposes truncation instead of silently hiding older events", () => {
  const row = {
    id: eventId,
    visit_id: visitId,
    event_type: "schedule_changed",
    actor_name: "Иван Петров",
    reason: null,
    before_state: { scheduledStartAt: "2026-08-31T07:00:00Z" },
    after_state: { scheduledStartAt: "2026-09-01T07:00:00Z" },
    created_at: "2026-08-30T12:15:00Z",
    total_count: 501,
  };

  const feed = buildVisitHistoryFeed([row], 500);
  assert.equal(feed.events.length, 1);
  assert.equal(feed.totalCount, 501);
  assert.equal(feed.hasMore, true);
});
