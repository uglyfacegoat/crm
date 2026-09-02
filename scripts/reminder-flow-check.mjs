import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { parseReminderWorkerResult } from "./reminder-worker-config.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to verify reminder provisioning.");

const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
const rollbackSignal = new Error("REMINDER_FLOW_CHECK_ROLLBACK");

try {
  const [fixture] = await sql`SELECT orders.organization_id, orders.id AS order_id, orders.client_id, orders.object_id,
      members.id AS member_id
    FROM orders
    JOIN organization_members members ON members.organization_id = orders.organization_id
      AND members.active AND members.role <> 'master'
    ORDER BY orders.created_at DESC, members.created_at
    LIMIT 1`;
  if (!fixture) throw new Error("Reminder flow check requires one order and one active office member.");

  try {
    await sql.begin(async (transaction) => {
      const contractId = randomUUID();
      const visitId = randomUUID();
      const contractNumber = `CHECK-${Date.now()}`;

      await transaction`INSERT INTO contracts (
          id, organization_id, client_id, object_id, contract_number, status,
          starts_on, ends_on, renewal_notice_days
        ) VALUES (
          ${contractId}, ${fixture.organization_id}, ${fixture.client_id}, ${fixture.object_id},
          ${contractNumber}, 'active', current_date - 365, current_date + 7, 30
        )`;
      await transaction`INSERT INTO service_visits (
          id, organization_id, order_id, object_id, scheduled_start_at, scheduled_end_at, status,
          client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by
        )
        SELECT ${visitId}, orders.organization_id, orders.id, orders.object_id, now() - interval '2 days',
          now() - interval '2 days' + interval '2 hours', 'planned', orders.client_name_snapshot,
          orders.object_name_snapshot, orders.object_address_snapshot, ${fixture.member_id}, ${fixture.member_id}
        FROM orders
        WHERE orders.organization_id = ${fixture.organization_id} AND orders.id = ${fixture.order_id}`;

      const [firstResult] = await transaction`SELECT * FROM provision_chat_operational_reminders(
        ${fixture.organization_id}, ${fixture.member_id}, NULL
      )`;
      const firstCycle = parseReminderWorkerResult(firstResult);
      assert.ok(firstCycle.closingActMessagesSynchronized >= 1, "The overdue closing-act reminder was not provisioned.");
      assert.ok(firstCycle.contractMessagesSynchronized >= 1, "The contract renewal reminder was not provisioned.");

      const activeMessages = await transaction`SELECT system_event_key FROM chat_messages
        WHERE organization_id = ${fixture.organization_id} AND deleted_at IS NULL
          AND (system_event_key = ${`closing_act_overdue:${visitId}`}
            OR system_event_key LIKE ${`contract_renewal:${contractId}:%`})`;
      assert.equal(activeMessages.length, 2, "Operational reminder messages were not persisted with stable keys.");

      const [secondResult] = await transaction`SELECT * FROM provision_chat_operational_reminders(
        ${fixture.organization_id}, ${fixture.member_id}, NULL
      )`;
      const secondCycle = parseReminderWorkerResult(secondResult);
      assert.equal(secondCycle.closingActMessagesSynchronized, 0, "Closing-act reminder was duplicated on the second cycle.");
      assert.equal(secondCycle.contractMessagesSynchronized, 0, "Contract reminder was duplicated on the second cycle.");

      await transaction`UPDATE service_visits SET status = 'cancelled', cancellation_reason = 'Проверка напоминаний'
        WHERE organization_id = ${fixture.organization_id} AND id = ${visitId}`;
      await transaction`UPDATE contracts SET status = 'completed'
        WHERE organization_id = ${fixture.organization_id} AND id = ${contractId}`;
      const [cleanupResult] = await transaction`SELECT * FROM provision_chat_operational_reminders(
        ${fixture.organization_id}, ${fixture.member_id}, NULL
      )`;
      const cleanupCycle = parseReminderWorkerResult(cleanupResult);
      assert.ok(cleanupCycle.obsoleteMessagesRemoved >= 2, "Resolved operational reminders were not removed.");

      const remainingMessages = await transaction`SELECT id FROM chat_messages
        WHERE organization_id = ${fixture.organization_id} AND deleted_at IS NULL
          AND system_event_key LIKE ANY(ARRAY[${`closing_act_overdue:${visitId}`}, ${`contract_renewal:${contractId}:%`}])`;
      assert.equal(remainingMessages.length, 0, "Resolved reminder messages remained visible.");
      throw rollbackSignal;
    });
  } catch (error) {
    if (error !== rollbackSignal) throw error;
  }

  console.log("Verified idempotent closing-act and contract reminders, including automatic cleanup.");
} finally {
  await sql.end();
}
