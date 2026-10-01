import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) {
  throw new Error("Run this database scenario through its isolated npm test command.");
}
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to an isolated PostgreSQL instance.");

const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, sourceRoot).href, context);
      if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => sql } });
const { createVisit, createVisitSeries, getVisitDispatchCard, listOrderVisits, updateVisit, VisitSeriesSelectionError, VisitVersionConflictError, VisitScheduleConflictError } = await import("../src/server/visits/repository.ts");
const { createVisitSeriesSchema } = await import("../src/server/visits/schemas.ts");

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
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address, area_square_meters)
    VALUES (${organization.id}, ${client.id}, 'Schedule object', 'Office', 'Test address', 250.50) RETURNING id`;
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
  const dispatch = await getVisitDispatchCard(members[0], firstVisitId);
  assert.equal(dispatch.clientKind, 'legal_entity');
  assert.equal(dispatch.areaSquareMeters, 250.5);
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
  const manual = createVisitSeriesSchema.parse({ idempotencyKey: randomUUID(), orderId: orders[0],
    scheduleMode: 'dates', selectedDates: ['2030-02-03', '2030-02-17'], startsOn: '2030-02-03', endsOn: '2030-02-17',
    localTime: '10:00', durationMinutes: 60, frequencyUnit: 'month', frequencyInterval: 1,
    assignedMasterId: '', notes: 'По выбранным дням' });
  const manualResult = await createVisitSeries(members[0], manual);
  assert.equal(manualResult.visitCount, 2);
  const [savedManual] = await sql`SELECT frequency_unit, selected_dates::text[] AS selected_dates FROM service_visit_series
    WHERE id = ${manualResult.seriesId}`;
  assert.equal(savedManual.frequency_unit, 'custom');
  assert.deepEqual(savedManual.selected_dates, ['2030-02-03', '2030-02-17']);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM service_visits WHERE series_id = ${manualResult.seriesId}`)[0].count, 2);
  const [alternate] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${organization.id}, 'Alternate master', '+70000000001', '+70000000001', 'Test region', 'Test zone') RETURNING id`;
  const [service] = await sql`INSERT INTO order_services (organization_id, order_id, service_name_snapshot, item_kind_snapshot,
    unit_snapshot, quantity, unit_price_minor, line_total_minor, position)
    VALUES (${organization.id}, ${orders[0]}, 'Area treatment', 'service', 'м²', 10, 1000, 10000, 1) RETURNING id`;
  const financeMember = { ...members[0], role: 'owner', permissionOverrides: { 'finance.write': true, 'finance.read': true } };
  const configured = createVisitSeriesSchema.parse({ ...manual, idempotencyKey: randomUUID(), expectedOrderVersion: 1,
    endTime: '', startsOn: '2030-03-03', endsOn: '2030-03-17', selectedDates: ['2030-03-03', '2030-03-17'],
    assignedMasterId: master.id, arrivalMode: 'fixed', notes: 'Common visit note',
    dateOverrides: [
      { date: '2030-03-03', serviceIds: [service.id], masterPayment: '250.50' },
      { date: '2030-03-17', serviceIds: [service.id], assignedMasterId: alternate.id, arrivalMode: 'window',
        startTime: '23:30', endTime: '00:30', visitNotes: 'Individual visit note', masterPayment: '125.75',
        serviceChanges: [{ id: service.id, quantity: '12.5', unitPrice: '20' }],
        extraServices: [{ name: 'Extra work', kind: 'service', unit: 'усл.', quantity: 2, unitPrice: '50' }] },
    ] });
  const result = await createVisitSeries(financeMember, configured);
  assert.equal(result.visitCount, 2);
  assert.deepEqual(await createVisitSeries(financeMember, configured), result, 'Retry returns the same series');
  const configuredVisits = await sql`SELECT * FROM service_visits WHERE series_id = ${result.seriesId} ORDER BY occurrence_number`;
  assert.deepEqual(configuredVisits.map(row => row.order_id), [orders[0], orders[0]]);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM orders WHERE organization_id = ${organization.id}`)[0].count, 4);
  assert.equal(configuredVisits[0].notes, 'Common visit note');
  assert.equal(configuredVisits[1].notes, 'Individual visit note');
  assert.equal(configuredVisits[1].assigned_master_id, alternate.id);
  assert.equal((configuredVisits[1].scheduled_end_at - configuredVisits[1].scheduled_start_at) / 60000, 60);
  assert.equal(configuredVisits[1].service_lines_snapshot[0].lineTotalMinor, 25000);
  assert.equal(configuredVisits[1].service_lines_snapshot[1].lineTotalMinor, 10000);
  const card = await getVisitDispatchCard(financeMember, configuredVisits[1].id);
  assert.equal(card.masterPaymentMinor, 12575);
  assert.equal(card.services[0].quantity, '12.500');
  assert.equal(card.services[1].name, 'Extra work');
  assert.equal((await getVisitDispatchCard(members[0], configuredVisits[1].id)).masterPaymentMinor, undefined);
  const publicVisit = (await listOrderVisits(members[0], orders[0])).find(row => row.id === configuredVisits[1].id);
  assert.equal(publicVisit.serviceSummary, 'Area treatment, Extra work');
  assert.equal(JSON.stringify(publicVisit).includes('unitPriceMinor'), false, 'Operational view does not expose financial snapshot fields');
  const [unchangedOrder] = await sql`SELECT version, agreed_total_minor, master_payment_snapshot_minor FROM orders WHERE id = ${orders[0]}`;
  assert.equal(unchangedOrder.version, 1);
  assert.equal(Number(unchangedOrder.agreed_total_minor), 100000);
  assert.equal(Number(unchangedOrder.master_payment_snapshot_minor), 100000);
  assert.equal((await sql`SELECT quantity::text AS quantity FROM order_services WHERE id = ${service.id}`)[0].quantity, '10.000');
  await assert.rejects(createVisitSeries(members[0], { ...configured, idempotencyKey: randomUUID() }), /not allowed/i);
  await assert.rejects(createVisitSeries(financeMember, { ...configured, idempotencyKey: randomUUID(), expectedOrderVersion: 999 }), VisitVersionConflictError);
  await assert.rejects(createVisitSeries(financeMember, { ...configured, idempotencyKey: randomUUID(),
    dateOverrides: [{ date: '2030-03-03', serviceIds: [randomUUID()] }] }), VisitSeriesSelectionError);
  await assert.rejects(createVisitSeries(financeMember, { ...configured, idempotencyKey: randomUUID(),
    dateOverrides: [{ date: '2030-03-03', extraServices: [{ catalogItemId: randomUUID(), name: 'Foreign catalog', kind: 'service', unit: 'усл.', quantity: 1, unitPrice: '10' }] }] }), VisitSeriesSelectionError);
  await assert.rejects(createVisitSeries({ ...members[0], permissionOverrides: { 'orders.write': false } },
    { ...configured, idempotencyKey: randomUUID(), dateOverrides: [{ date: '2030-03-03', serviceIds: [] }] }), /not allowed/i);
  await updateVisit(financeMember, { visitId: configuredVisits[0].id, expectedVersion: 1, localDate: '2030-03-03', localTime: '10:00',
    arrivalMode: 'fixed', endTime: null, durationMinutes: 60, status: 'planned', assignedMasterId: alternate.id,
    cancellationReason: null, rescheduleReason: null, notes: 'Changed master after creation' });
  assert.equal((await getVisitDispatchCard(financeMember, configuredVisits[0].id)).masterPaymentMinor, null, 'Changing a master clears the old visit payment');
  const seriesCount = (await sql`SELECT count(*)::integer AS count FROM service_visit_series`)[0].count;
  await assert.rejects(createVisitSeries(financeMember, { ...configured, idempotencyKey: randomUUID(),
    startsOn: '2030-03-01', endsOn: '2030-03-03', selectedDates: ['2030-03-01', '2030-03-03'],
    dateOverrides: [] }), /already has|already.*visit/i);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM service_visit_series`)[0].count, seriesCount, 'One conflicting date rolls back the whole series');
  assert.equal((await sql`SELECT count(*)::integer AS count FROM service_visits WHERE order_id = ${orders[0]} AND scheduled_start_at::date = '2030-03-01'`)[0].count, 0);

});
