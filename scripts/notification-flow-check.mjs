import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { parseOperationalNotificationResult } from "./reminder-worker-config.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify notification provisioning.");

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
const rollbackSignal = new Error("NOTIFICATION_FLOW_CHECK_ROLLBACK");

try {
  const [fixture] = await sql`SELECT orders.organization_id, orders.id AS order_id, orders.object_id,
      orders.client_name_snapshot, orders.object_name_snapshot, orders.object_address_snapshot,
      members.id AS member_id
    FROM orders
    JOIN organization_members members ON members.organization_id = orders.organization_id
      AND members.active AND members.role = 'admin'
    ORDER BY orders.created_at DESC, members.created_at
    LIMIT 1`;
  if (!fixture) throw new Error("Notification flow check requires one order and one active administrator.");

  try {
    await sql.begin(async (transaction) => {
      const visitId = randomUUID();
      const taskId = randomUUID();
      await transaction`INSERT INTO service_visits (
          id, organization_id, order_id, object_id, scheduled_start_at, scheduled_end_at, status,
          client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by
        ) VALUES (
          ${visitId}, ${fixture.organization_id}, ${fixture.order_id}, ${fixture.object_id},
          now() + interval '1 day', now() + interval '1 day 2 hours', 'planned',
          ${fixture.client_name_snapshot}, ${fixture.object_name_snapshot}, ${fixture.object_address_snapshot},
          ${fixture.member_id}, ${fixture.member_id}
        )`;
      await transaction`INSERT INTO tasks (
          id, organization_id, title, status, priority, due_at, assigned_member_id, source, created_by, updated_by
        ) VALUES (
          ${taskId}, ${fixture.organization_id}, 'Проверить персональное уведомление', 'open', 'critical',
          now() - interval '1 day', ${fixture.member_id}, 'manual', ${fixture.member_id}, ${fixture.member_id}
        )`;

      const [firstResult] = await transaction`SELECT * FROM provision_operational_notifications(${fixture.organization_id})`;
      const firstCycle = parseOperationalNotificationResult(firstResult);
      assert.ok(firstCycle.unassignedNotificationsSynchronized >= 1, "Unassigned visit notification was not provisioned.");
      assert.ok(firstCycle.taskNotificationsSynchronized >= 1, "Overdue task notification was not provisioned.");

      const notifications = await transaction`SELECT id, kind, read_at, resolved_at FROM notifications
        WHERE organization_id = ${fixture.organization_id} AND recipient_member_id = ${fixture.member_id}
          AND source_id IN (${visitId}, ${taskId})
        ORDER BY kind`;
      assert.ok(notifications.length >= 2, "The administrator did not receive the personal visit and task notifications.");
      assert.ok(notifications.some((notification) => notification.kind === "visit_unassigned"));
      assert.ok(notifications.some((notification) => notification.kind === "task_overdue"));
      assert.ok(notifications.every((notification) => notification.read_at === null && notification.resolved_at === null));

      await transaction`UPDATE notifications SET read_at = now()
        WHERE organization_id = ${fixture.organization_id} AND recipient_member_id = ${fixture.member_id}
          AND source_id = ${taskId}`;
      const [secondResult] = await transaction`SELECT * FROM provision_operational_notifications(${fixture.organization_id})`;
      const secondCycle = parseOperationalNotificationResult(secondResult);
      assert.equal(secondCycle.taskNotificationsSynchronized, 0, "The overdue task notification was duplicated.");
      const [readState] = await transaction`SELECT read_at FROM notifications
        WHERE organization_id = ${fixture.organization_id} AND recipient_member_id = ${fixture.member_id}
          AND source_id = ${taskId}`;
      assert.ok(readState.read_at instanceof Date, "Provisioning unexpectedly reset the personal read state.");

      await transaction`UPDATE tasks SET status = 'completed', completed_at = now(), completed_by = ${fixture.member_id}
        WHERE organization_id = ${fixture.organization_id} AND id = ${taskId}`;
      await transaction`UPDATE service_visits SET status = 'cancelled', cancellation_reason = 'Проверка уведомлений'
        WHERE organization_id = ${fixture.organization_id} AND id = ${visitId}`;
      const [cleanupResult] = await transaction`SELECT * FROM provision_operational_notifications(${fixture.organization_id})`;
      const cleanupCycle = parseOperationalNotificationResult(cleanupResult);
      assert.ok(cleanupCycle.notificationsResolved >= notifications.length, "Resolved notification sources remained active.");
      const active = await transaction`SELECT id FROM notifications
        WHERE organization_id = ${fixture.organization_id} AND recipient_member_id = ${fixture.member_id}
          AND source_id IN (${visitId}, ${taskId}) AND resolved_at IS NULL`;
      assert.equal(active.length, 0, "Resolved notifications remained visible.");
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  console.log("Verified personal notification delivery, idempotency, read-state preservation, and automatic resolution.");
} finally {
  await sql.end();
}
