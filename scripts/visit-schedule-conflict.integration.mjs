import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to an isolated PostgreSQL instance.");

const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
      if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => sql } });
const { createVisit, VisitScheduleConflictError } = await import("../src/server/visits/repository.ts");

test("master schedule rejects sequential and simultaneous conflicting assignments", { timeout: 60_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_visit_conflict_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let created = false;
  let left;
  let right;
  t.after(async () => {
    hooks.deregister();
    mock.restoreAll();
    await left?.end();
    await right?.end();
    await sql?.end();
    try { if (created) await admin`DROP DATABASE ${admin(databaseName)}`; }
    finally { await admin.end(); }
  });

  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await runMigrations({ databaseUrl: databaseUrl.toString(), onApplied: () => {} });
  sql = postgres(databaseUrl.toString(), { max: 4, onnotice: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Schedule conflict acceptance', 'Europe/Moscow') RETURNING id`;
  const members = [];
  for (const index of [1, 2]) {
    const [row] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, ${`Scheduler ${index}`}, ${`scheduler-${index}@example.invalid`}, 'admin') RETURNING id`;
    members.push({ organizationId: organization.id, memberId: row.id, role: "admin", permissionOverrides: {}, sessionId: null });
  }
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name)
    VALUES (${organization.id}, 'Schedule customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organization.id}, ${client.id}, 'Schedule object', 'Office', 'Test address') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${organization.id}, 'Schedule master', '+70000000000', '+70000000000', 'Test region', 'Test zone') RETURNING id`;
  const orders = [];
  for (const index of [1, 2, 3, 4]) {
    const [row] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot, assigned_master_id, master_name_snapshot,
      agreed_total_minor, master_payment_snapshot_minor)
      VALUES (${organization.id}, ${client.id}, ${object.id}, ${`SCHEDULE-${index}`}, 'new', 'RUB',
        'Schedule customer', 'Schedule object', 'Test address', ${master.id}, 'Schedule master', 100000, 100000) RETURNING id`;
    orders.push(row.id);
  }

  const input = (orderId, localTime) => ({
    idempotencyKey: randomUUID(), orderId, localDate: "2030-01-15", localTime,
    durationMinutes: 60, assignedMasterId: master.id, notes: null,
  });
  const firstVisitId = await createVisit(members[0], input(orders[0], "10:00"));
  await assert.rejects(createVisit(members[1], input(orders[1], "10:30")), VisitScheduleConflictError);
  assert.equal(Number((await sql`SELECT count(*) FROM service_visits WHERE organization_id = ${organization.id}`)[0].count), 1);
  assert.equal(Number((await sql`SELECT count(*) FROM tasks WHERE related_visit_id = ${firstVisitId}`)[0].count), 1);
  assert.equal(Number((await sql`SELECT count(*) FROM service_visit_events WHERE visit_id = ${firstVisitId}`)[0].count), 1);
  await createVisit(members[1], input(orders[1], "11:00"));

  // Two separate connections emulate employees saving at the same time. The
  // second write must wait for the first uncommitted write, then fail with the
  // database exclusion constraint rather than producing an overlapping visit.
  left = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} });
  right = postgres(databaseUrl.toString(), { max: 1, onnotice: () => {} });
  const insert = (connection, orderId, actorId) => connection`INSERT INTO service_visits (
    organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot,
    created_by, updated_by
  ) VALUES (
    ${organization.id}, ${orderId}, ${object.id}, ${master.id},
    '2030-01-15T14:00:00Z', '2030-01-15T15:00:00Z', 'planned',
    'Schedule customer', 'Schedule object', 'Test address', 'Schedule master', ${actorId}, ${actorId}
  )`;
  await left`BEGIN`;
  await right`BEGIN`;
  await insert(left, orders[2], members[0].memberId);
  const secondResult = insert(right, orders[3], members[1].memberId)
    .then(() => ({ status: "inserted" }), (error) => ({ status: "rejected", code: error.code, constraint: error.constraint_name }));
  assert.equal((await Promise.race([secondResult, delay(100).then(() => ({ status: "waiting" }))])).status, "waiting");
  await left`COMMIT`;
  assert.deepEqual(await secondResult, {
    status: "rejected", code: "23P01", constraint: "service_visits_master_no_overlap",
  });
  await right`ROLLBACK`;
  assert.equal(Number((await sql`SELECT count(*) FROM service_visits WHERE organization_id = ${organization.id}
    AND scheduled_start_at = '2030-01-15T14:00:00Z'`)[0].count), 1);
});
