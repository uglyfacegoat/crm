import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { mock, test } from 'node:test';
import postgres from 'postgres';
import { runMigrations } from './migrate.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error('Run through the isolated PostgreSQL fixture.');
const root = new URL('../src/', import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? '' : '.ts'}`, root).href, context);
    if (specifier.startsWith('.') && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module('server-only', { namedExports: {} });
mock.module(new URL('server/database.ts', root), { namedExports: { getDatabase: () => sql } });
const { copyOrder, OrderCopyScheduleConflictError } = await import('../src/server/orders/copy-repository.ts');
const { copyOrderSchema, addOrderExpenseSchema, updateOrderSchema } = await import('../src/server/orders/schemas.ts');
const { addOrderExpense, updateOrder } = await import('../src/server/orders/repository.ts');
const { AuthorizationError } = await import('../src/server/auth/permissions.ts');

test('selected-date order copies preserve chosen fields, group orders and roll back conflicts', async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_order_copy_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Copy test', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${org.id}, 'Owner', 'copy-owner@invalid.test', 'admin') RETURNING id`;
  const member = { organizationId: org.id, organizationName: 'Copy test', memberId: person.id,
    displayName: 'Owner', email: 'copy-owner@invalid.test', role: 'admin', masterId: null, sessionId: null, permissionOverrides: {} };
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${org.id}, 'Customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${org.id}, ${client.id}, 'Warehouse', 'Склад', 'Moscow') RETURNING id`;
  const [secondObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${org.id}, ${client.id}, 'Warehouse 2', 'Склад', 'Tver city') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${org.id}, 'Master', '+70000000000', '+70000000000', 'Moscow', 'Center') RETURNING id`;
  const [contact] = await sql`INSERT INTO client_contacts (organization_id, client_id, full_name, phone, normalized_phone)
    VALUES (${org.id}, ${client.id}, 'Contact', '+79990000000', '+79990000000') RETURNING id`;
  const [secondContact] = await sql`INSERT INTO client_contacts (organization_id, client_id, full_name, phone, normalized_phone)
    VALUES (${org.id}, ${client.id}, 'Contact 2', '+79990000001', '+79990000001') RETURNING id`;
  const [source] = await sql`INSERT INTO orders (organization_id, client_id, object_id, client_contact_id, order_number, status, currency,
    assigned_master_id, master_payment_snapshot_minor, client_name_snapshot, object_name_snapshot, object_address_snapshot,
    contact_name_snapshot, contact_phone_snapshot, master_name_snapshot, master_phone_snapshot, notes)
    VALUES (${org.id}, ${client.id}, ${object.id}, ${contact.id}, 'SOURCE', 'new', 'RUB', ${master.id}, 5000,
      'Customer', 'Warehouse', 'Moscow', 'Contact', '+79990000000', 'Master', '+70000000000', 'Private note') RETURNING id`;
  await sql`INSERT INTO order_contacts (organization_id, order_id, contact_id, position) VALUES
    (${org.id}, ${source.id}, ${contact.id}, 1), (${org.id}, ${source.id}, ${secondContact.id}, 2)`;
  await sql`INSERT INTO order_objects (organization_id, order_id, object_id, position) VALUES
    (${org.id}, ${source.id}, ${object.id}, 1), (${org.id}, ${source.id}, ${secondObject.id}, 2)`;
  const [firstService] = await sql`INSERT INTO order_services (organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position)
    VALUES (${org.id}, ${source.id}, 'Disinfection', 1, 10000, 10000, 1) RETURNING id`;
  await sql`INSERT INTO order_services (organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position)
    VALUES (${org.id}, ${source.id}, 'Extra', 1, 5000, 5000, 2)`;
  const [sourceVisit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, created_by, updated_by)
    VALUES (${org.id}, ${source.id}, ${object.id}, ${master.id}, '2030-01-05T07:00:00Z', '2030-01-05T08:00:00Z', 'planned',
    'Customer', 'Warehouse', 'Moscow', 'Master', ${person.id}, ${person.id}) RETURNING id`;
  const input = copyOrderSchema.parse({ idempotencyKey: randomUUID(), sourceOrderId: source.id, expectedVersion: 1,
    copyDate: '2030-01-12', copyDates: ['2030-01-12', '2030-01-19'], serviceIds: [firstService.id],
    expenseIds: [], visitIds: [sourceVisit.id], copyContact: false, copyRelatedObjects: false, copyMaster: false, copyNotes: true });
  const firstId = await copyOrder(member, input);
  assert.equal(await copyOrder(member, input), firstId);
  const copies = await sql`SELECT id, client_contact_id, assigned_master_id, notes, agreed_total_minor FROM orders
    WHERE organization_id = ${org.id} AND id <> ${source.id} ORDER BY created_at, id`;
  assert.equal(copies.length, 2);
  assert.equal(copies[0].notes, 'Private note');
  assert.equal(copies[0].assigned_master_id, null);
  assert.equal(copies[0].client_contact_id, null);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_contacts WHERE order_id = ${firstId}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_objects WHERE order_id = ${firstId}`)[0].count, 1);
  assert.deepEqual(copies.map((row) => Number(row.agreed_total_minor)), [10000, 10000]);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_services WHERE order_id IN ${sql(copies.map((row) => row.id))}`)[0].count, 2);
  const visits = await sql`SELECT (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::date::text AS local_date, assigned_master_id
    FROM service_visits WHERE order_id IN ${sql(copies.map((row) => row.id))} ORDER BY scheduled_start_at`;
  assert.deepEqual(visits.map((row) => row.local_date), ['2030-01-12', '2030-01-19']);
  assert.equal(visits.every((row) => row.assigned_master_id === null), true);
  const [group] = await sql`SELECT group_id FROM order_group_members WHERE order_id = ${firstId}`;
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_group_members WHERE group_id = ${group.group_id}`)[0].count, 3);

  // One unavailable master slot must abort the whole next series.
  await sql`INSERT INTO service_visits (organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, created_by, updated_by)
    VALUES (${org.id}, ${source.id}, ${object.id}, ${master.id}, '2030-02-19T07:00:00Z', '2030-02-19T08:00:00Z', 'planned',
    'Customer', 'Warehouse', 'Moscow', 'Master', ${person.id}, ${person.id})`;
  const conflicting = copyOrderSchema.parse({ ...input, idempotencyKey: randomUUID(), copyDate: '2030-02-12',
    copyDates: ['2030-02-12', '2030-02-19'], copyMaster: true });
  await assert.rejects(copyOrder(member, conflicting), OrderCopyScheduleConflictError);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM orders WHERE organization_id = ${org.id}`)[0].count, 3);
  const blankInput = copyOrderSchema.parse({ ...input, idempotencyKey: randomUUID(), copyDate: '2030-03-01',
    copyDates: [], serviceIds: [], visitIds: [], copyContact: true, copyRelatedObjects: true, copyNotes: false });
  const blankId = await copyOrder(member, blankInput);
  const [blank] = await sql`SELECT agreed_total_minor, client_contact_id, notes, price_pending FROM orders WHERE id = ${blankId}`;
  assert.equal(Number(blank.agreed_total_minor), 0);
  assert.equal(blank.client_contact_id, contact.id);
  assert.equal(blank.notes, null);
  assert.equal(blank.price_pending, true);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_services WHERE order_id = ${blankId}`)[0].count, 0);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_contacts WHERE order_id = ${blankId}`)[0].count, 2);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_objects WHERE order_id = ${blankId}`)[0].count, 2);
  const [fuelExpense] = await sql`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, created_by)
    VALUES (${org.id}, ${source.id}, 'Fuel', 7000, '2030-01-05', ${person.id}) RETURNING id`;
  const [materialsExpense] = await sql`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, created_by)
    VALUES (${org.id}, ${source.id}, 'Materials', 12000, '2030-01-05', ${person.id}) RETURNING id`;
  const selectionDates = ['2030-03-08', '2030-03-15'];
  const coordinator = { ...member, role: 'crm_coordinator' };
  const financialMember = { ...member, role: 'owner' };
  await assert.rejects(copyOrder(coordinator, copyOrderSchema.parse({ ...blankInput,
    idempotencyKey: randomUUID(), copyDate: selectionDates[0], expenseIds: [fuelExpense.id],
  })), AuthorizationError);
  await assert.rejects(copyOrder(coordinator, copyOrderSchema.parse({ ...blankInput,
    idempotencyKey: randomUUID(), copyDate: selectionDates[0],
    dateOverrides: [{ date: selectionDates[0], expenseIds: [fuelExpense.id] }],
  })), AuthorizationError);
  await assert.rejects(addOrderExpense(coordinator, addOrderExpenseSchema.parse({
    idempotencyKey: randomUUID(), orderId: source.id, category: 'Hidden cost', amount: '1', occurredOn: selectionDates[0], note: '',
  })), AuthorizationError);
  const financeController = { ...member, role: 'finance_controller' };
  const financeExpenseId = await addOrderExpense(financeController, addOrderExpenseSchema.parse({
    idempotencyKey: randomUUID(), orderId: blankId, category: 'Approved cost', amount: '25', occurredOn: selectionDates[0], note: '',
  }));
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_expenses WHERE id = ${financeExpenseId} AND amount_minor = 2500`)[0].count, 1);
  await copyOrder(financialMember, copyOrderSchema.parse({ ...blankInput, idempotencyKey: randomUUID(),
    copyDate: selectionDates[0], copyDates: selectionDates,
    serviceIds: [firstService.id], expenseIds: [fuelExpense.id],
    dateOverrides: [{ date: selectionDates[1], serviceIds: [], expenseIds: [materialsExpense.id] }],
  }));
  const selectedCopies = await sql`SELECT copied.id, audit.changes->>'copyDate' AS copy_date
    FROM audit_events audit JOIN orders copied ON copied.organization_id = audit.organization_id AND copied.id = audit.entity_id
    WHERE audit.organization_id = ${org.id} AND audit.action = 'order.copy'
      AND audit.changes->>'sourceOrderId' = ${source.id}
      AND audit.changes->>'copyDate' IN (${selectionDates[0]}, ${selectionDates[1]})
    ORDER BY audit.changes->>'copyDate'`;
  assert.deepEqual(selectedCopies.map((copy) => copy.copy_date), selectionDates);
  const selectedRows = await sql`SELECT orders.id, orders.client_contact_id,
      (SELECT count(*)::int FROM order_contacts WHERE order_id = orders.id) AS contacts,
      (SELECT count(*)::int FROM order_objects WHERE order_id = orders.id) AS objects,
      (SELECT count(*)::int FROM order_services WHERE order_id = orders.id) AS services,
      (SELECT string_agg(category, ',') FROM order_expenses WHERE order_id = orders.id) AS expense,
      (SELECT min(occurred_on)::text FROM order_expenses WHERE order_id = orders.id) AS expense_date
    FROM orders WHERE id IN ${sql(selectedCopies.map((copy) => copy.id))} ORDER BY id`;
  const selectedById = new Map(selectedRows.map((row) => [row.id, row]));
  assert.deepEqual(selectedCopies.map((copy) => {
    const row = selectedById.get(copy.id);
    return [row.client_contact_id, row.contacts, row.objects, row.services, row.expense, row.expense_date];
  }), [
    [contact.id, 2, 2, 1, 'Fuel', selectionDates[0]],
    [contact.id, 2, 2, 0, 'Materials', selectionDates[1]],
  ]);
  const [minimal] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${org.id}, ${client.id}, null, 'MINIMAL', 'new', 'RUB', 'Customer', 'Объект не указан', 'Адрес не указан') RETURNING id`;
  const minimalInput = copyOrderSchema.parse({ ...blankInput, idempotencyKey: randomUUID(), sourceOrderId: minimal.id,
    copyDate: '2030-03-02', copyContact: false });
  const minimalCopyId = await copyOrder(member, minimalInput);
  const [minimalCopy] = await sql`SELECT object_id, price_pending FROM orders WHERE id = ${minimalCopyId}`;
  assert.equal(minimalCopy.object_id, null);
  assert.equal(minimalCopy.price_pending, true);
  const customized = copyOrderSchema.parse({ ...input, idempotencyKey: randomUUID(), copyDate: '2030-04-12',
    copyDates: ['2030-04-12', '2030-04-19'], dateOverrides: [{ date: '2030-04-19', assignedMasterId: master.id, masterPayment: '250',
      serviceIds: [], notes: 'Special visit', startTime: '13:30', endTime: '15:00',
      extraServices: [{ name: 'Additional work', kind: 'service', unit: 'м²', quantity: 2, unitPrice: 150 }] }] });
  await copyOrder(financialMember, customized);
  const customizedOrders = await sql`SELECT id, notes, assigned_master_id, master_payment_snapshot_minor, agreed_total_minor FROM orders
    WHERE organization_id = ${org.id} AND notes IN ('Private note', 'Special visit') ORDER BY created_at DESC LIMIT 2`;
  const special = customizedOrders.find((row) => row.notes === 'Special visit');
  assert.ok(special);
  assert.equal(special.assigned_master_id, master.id);
  assert.equal(Number(special.master_payment_snapshot_minor), 25000);
  assert.equal(Number(special.agreed_total_minor), 30000);
  const [specialVisit] = await sql`SELECT (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::time::text AS starts,
    (scheduled_end_at AT TIME ZONE 'Europe/Moscow')::time::text AS ends, assigned_master_id
    FROM service_visits WHERE order_id = ${special.id}`;
  assert.equal(specialVisit.starts, '13:30:00');
  assert.equal(specialVisit.ends, '15:00:00');
  assert.equal(specialVisit.assigned_master_id, master.id);
  const overnight = copyOrderSchema.parse({ ...input, idempotencyKey: randomUUID(), copyDate: '2030-05-12',
    copyDates: [], dateOverrides: [{ date: '2030-05-12', startTime: '23:30', endTime: '01:00' }] });
  const overnightId = await copyOrder(member, overnight);
  const [overnightVisit] = await sql`SELECT (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::timestamp::text AS starts,
    (scheduled_end_at AT TIME ZONE 'Europe/Moscow')::timestamp::text AS ends
    FROM service_visits WHERE order_id = ${overnightId}`;
  assert.equal(overnightVisit.starts, '2030-05-12 23:30:00');
  assert.equal(overnightVisit.ends, '2030-05-13 01:00:00');
  const scheduledWithoutSourceVisit = copyOrderSchema.parse({ ...blankInput, idempotencyKey: randomUUID(),
    copyDate: '2030-06-12', copyDates: ['2030-06-12', '2030-06-19'],
    dateOverrides: [
      { date: '2030-06-12', arrivalMode: 'fixed', startTime: '09:30', assignedMasterId: master.id },
      { date: '2030-06-19', arrivalMode: 'window', startTime: '14:00', endTime: '16:30' },
    ] });
  const scheduledFirstId = await copyOrder(member, scheduledWithoutSourceVisit);
  const scheduledGroup = await sql`SELECT group_id FROM order_group_members WHERE order_id = ${scheduledFirstId}`;
  const scheduledCopies = await sql`SELECT orders.id, orders.status, service_visits.arrival_mode,
    (service_visits.scheduled_start_at AT TIME ZONE 'Europe/Moscow')::time::text AS starts,
    (service_visits.scheduled_end_at AT TIME ZONE 'Europe/Moscow')::time::text AS ends
    FROM orders JOIN order_group_members ON order_group_members.order_id = orders.id
    JOIN service_visits ON service_visits.order_id = orders.id
    WHERE order_group_members.group_id = ${scheduledGroup[0].group_id}
      AND orders.id <> ${source.id} AND service_visits.scheduled_start_at >= '2030-06-01'
    ORDER BY service_visits.scheduled_start_at`;
  assert.equal(scheduledCopies.length, 2);
  assert.deepEqual(scheduledCopies.map((row) => [row.status, row.arrival_mode, row.starts, row.ends]), [
    ['scheduled', 'fixed', '09:30:00', '11:30:00'],
    ['scheduled', 'window', '14:00:00', '16:30:00'],
  ]);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks
    WHERE source = 'visit_reminder' AND related_order_id IN ${sql(scheduledCopies.map((row) => row.id))}`)[0].count, 2);
  assert.equal(copyOrderSchema.safeParse({ ...scheduledWithoutSourceVisit, dateOverrides: [
    { date: '2030-06-12', arrivalMode: 'fixed' },
  ] }).success, false);
  assert.equal(copyOrderSchema.safeParse({ ...scheduledWithoutSourceVisit, dateOverrides: [
    { date: '2030-06-19', arrivalMode: 'window' },
  ] }).success, false);
  const [catalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode)
    VALUES (${org.id}, 'service', 'Inspection', 'м²', 'variable') RETURNING id`;
  const pendingCatalogCopy = copyOrderSchema.parse({ ...blankInput, idempotencyKey: randomUUID(),
    copyDate: '2030-07-12', dateOverrides: [{ date: '2030-07-12', extraServices: [{
      catalogItemId: catalog.id, name: 'Inspection', kind: 'service', unit: 'м²', quantity: 25, unitPrice: '',
    }] }] });
  const pendingCatalogId = await copyOrder(member, pendingCatalogCopy);
  const [pendingCatalogOrder] = await sql`SELECT price_pending FROM orders WHERE id = ${pendingCatalogId}`;
  const [pendingCatalogLine] = await sql`SELECT catalog_item_id, price_pending, unit_price_minor
    FROM order_services WHERE order_id = ${pendingCatalogId}`;
  assert.equal(pendingCatalogOrder.price_pending, true);
  assert.equal(pendingCatalogLine.catalog_item_id, catalog.id);
  assert.equal(pendingCatalogLine.price_pending, true);
  assert.equal(Number(pendingCatalogLine.unit_price_minor), 0);
  await assert.rejects(copyOrder(member, copyOrderSchema.parse({ ...pendingCatalogCopy,
    idempotencyKey: randomUUID(), copyDate: '2030-07-19',
    dateOverrides: [{ date: '2030-07-19', extraServices: [{ ...pendingCatalogCopy.dateOverrides[0].extraServices[0], kind: 'product' }] }],
  })), /справочнике/);
  const extraCatalogLine = pendingCatalogCopy.dateOverrides[0].extraServices[0];
  for (const [date, changes] of [
    ['2030-07-26', { name: 'Unrelated work' }],
    ['2030-08-02', { unit: 'шт.' }],
  ]) {
    await assert.rejects(copyOrder(member, copyOrderSchema.parse({ ...pendingCatalogCopy,
      idempotencyKey: randomUUID(), copyDate: date,
      dateOverrides: [{ date, extraServices: [{ ...extraCatalogLine, ...changes }] }],
    })), /справочнике/);
  }
  await sql`INSERT INTO object_service_profiles (organization_id, object_id) VALUES (${org.id}, ${object.id})`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${org.id}, ${object.id}, ${catalog.id}, 'Contract inspection', 'contract', 'area', 75, 1)`;
  await sql`INSERT INTO object_service_profiles (organization_id, object_id) VALUES (${org.id}, ${secondObject.id})`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${org.id}, ${secondObject.id}, ${catalog.id}, 'Other object inspection', 'contract', 'area', 90, 1)`;
  const otherObjectDate = '2030-08-16';
  await assert.rejects(copyOrder(member, copyOrderSchema.parse({ ...pendingCatalogCopy,
    idempotencyKey: randomUUID(), copyDate: otherObjectDate,
    dateOverrides: [{ date: otherObjectDate, extraServices: [{ ...extraCatalogLine, name: 'Other object inspection' }] }],
  })), /справочнике/);
  const contractDate = '2030-08-09';
  const contractCopyId = await copyOrder(member, copyOrderSchema.parse({ ...pendingCatalogCopy,
    idempotencyKey: randomUUID(), copyDate: contractDate,
    dateOverrides: [{ date: contractDate, extraServices: [{ ...extraCatalogLine, name: 'Contract inspection', unitPrice: '0.75' }] }],
  }));
  const [contractCopyLine] = await sql`SELECT catalog_item_id, service_name_snapshot, unit_snapshot, line_total_minor
    FROM order_services WHERE order_id = ${contractCopyId}`;
  assert.equal(contractCopyLine.catalog_item_id, catalog.id);
  assert.equal(contractCopyLine.service_name_snapshot, 'Contract inspection');
  assert.equal(contractCopyLine.unit_snapshot, 'м²');
  assert.equal(Number(contractCopyLine.line_total_minor), 1875);
  const coordinatorEdit = { orderId: source.id, expectedVersion: 1, status: 'new', statusReason: '',
    assignedMasterId: master.id, notes: 'Updated without finance access', agreedTotal: '0', services: [] };
  await assert.rejects(updateOrder(coordinator, updateOrderSchema.parse({ ...coordinatorEdit, masterPayment: '99' })), AuthorizationError);
  assert.equal(await updateOrder(coordinator, updateOrderSchema.parse({ ...coordinatorEdit, masterPayment: 'preserve' })), 2);
  const [preservedPayment] = await sql`SELECT master_payment_snapshot_minor, notes FROM orders WHERE id = ${source.id}`;
  assert.equal(Number(preservedPayment.master_payment_snapshot_minor), 5000);
  assert.equal(preservedPayment.notes, 'Updated without finance access');
  const coordinatorMasterCopy = await copyOrder(coordinator, copyOrderSchema.parse({ ...blankInput,
    idempotencyKey: randomUUID(), sourceOrderId: source.id, expectedVersion: 2,
    copyDate: '2030-09-12', copyMaster: true,
  }));
  const [coordinatorCopiedMaster] = await sql`SELECT assigned_master_id, master_payment_snapshot_minor FROM orders WHERE id = ${coordinatorMasterCopy}`;
  assert.equal(coordinatorCopiedMaster.assigned_master_id, master.id);
  assert.equal(coordinatorCopiedMaster.master_payment_snapshot_minor, null);
  await assert.rejects(copyOrder(coordinator, copyOrderSchema.parse({ ...blankInput,
    idempotencyKey: randomUUID(), sourceOrderId: source.id, expectedVersion: 2, copyDate: '2030-09-19',
    dateOverrides: [{ date: '2030-09-19', masterPayment: '99' }],
  })), AuthorizationError);
});
