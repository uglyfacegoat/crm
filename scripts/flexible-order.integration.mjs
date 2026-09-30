import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error("Run through the isolated PostgreSQL fixture.");
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, root).href, context);
    if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", root), { namedExports: { getDatabase: () => sql } });
const { createFlexibleOrder, FlexibleOrderReferenceError } = await import("../src/server/quick-order/flexible-repository.ts");
const { AuthorizationError } = await import("../src/server/auth/permissions.ts");
const { flexibleOrderSchema } = await import("../src/server/quick-order/flexible-schemas.ts");
const { getOrderDetail, updateOrder } = await import("../src/server/orders/repository.ts");
const { deleteCatalogItem } = await import("../src/server/catalog/repository.ts");
const { updateOrderSchema } = await import("../src/server/orders/schemas.ts");
const { getClientDetail, completeClientContact, completeClientObject } = await import("../src/server/clients/repository.ts");

test("name-only orders and multiple contacts, numbers and objects persist and stay in their organization", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_flexible_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  async function member(name, email) {
    const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES (${name}, 'Europe/Moscow') RETURNING id`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Owner', ${email}, 'admin') RETURNING id`;
    return { sessionId: null, organizationId: org.id, organizationName: name, memberId: person.id, displayName: 'Owner', email, role: 'admin', masterId: null, permissionOverrides: {} };
  }
  const a = await member('Flexible A', 'a@flexible.invalid');
  const b = await member('Flexible B', 'b@flexible.invalid');
  const bare = flexibleOrderSchema.parse({ idempotencyKey: randomUUID(), client: { mode: 'new', kind: 'individual', name: 'Анна Иванова' } });
  const bareId = await createFlexibleOrder(a, bare);
  assert.equal(await createFlexibleOrder(a, bare), bareId);
  const simultaneous = flexibleOrderSchema.parse({ idempotencyKey: randomUUID(), client: { mode: 'new', kind: 'individual', name: 'Параллельный заказчик' } });
  const [firstConcurrentId, secondConcurrentId] = await Promise.all([createFlexibleOrder(a, simultaneous), createFlexibleOrder(a, simultaneous)]);
  assert.equal(firstConcurrentId, secondConcurrentId);
  const [concurrentCount] = await sql`SELECT count(*)::int AS orders FROM orders WHERE organization_id = ${a.organizationId} AND client_name_snapshot = 'Параллельный заказчик'`;
  assert.equal(concurrentCount.orders, 1);
  const [coordinatorRow] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${a.organizationId}, 'Coordinator', 'coordinator@flexible.invalid', 'crm_coordinator') RETURNING id`;
  const coordinator = { ...a, memberId: coordinatorRow.id, displayName: 'Coordinator', email: 'coordinator@flexible.invalid', role: 'crm_coordinator' };
  const [payoutMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${a.organizationId}, 'Flexible master', '+70000000047', '+70000000047', 'Москва', 'Москва') RETURNING id`;
  const coordinatorOrder = { client: { mode: 'new', kind: 'individual', name: 'Заказ координатора' }, assignedMasterId: payoutMaster.id };
  await assert.rejects(createFlexibleOrder(coordinator, flexibleOrderSchema.parse({ ...coordinatorOrder, idempotencyKey: randomUUID(), masterPayment: '4000' })), AuthorizationError);
  const coordinatorOrderId = await createFlexibleOrder(coordinator, flexibleOrderSchema.parse({ ...coordinatorOrder, idempotencyKey: randomUUID() }));
  const [coordinatorOrderRow] = await sql`SELECT assigned_master_id, master_payment_snapshot_minor FROM orders WHERE id = ${coordinatorOrderId}`;
  assert.equal(coordinatorOrderRow.assigned_master_id, payoutMaster.id);
  assert.equal(coordinatorOrderRow.master_payment_snapshot_minor, null);
  const detail = await getOrderDetail(a, bareId);
  assert.equal(detail.pricePending, true);
  assert.equal(detail.agreedTotalMinor, 0);
  assert.deepEqual(detail.relatedContacts, []);
  assert.deepEqual(detail.relatedObjects, []);
  const [bareRow] = await sql`SELECT client_id, object_id, client_contact_id FROM orders WHERE id = ${bareId}`;
  assert.equal(bareRow.object_id, null);
  assert.equal(bareRow.client_contact_id, null);
  await updateOrder(a, updateOrderSchema.parse({ orderId: bareId, expectedVersion: 1, status: 'new', statusReason: '', assignedMasterId: '', masterPayment: '', notes: 'Уточнить детали', agreedTotal: '0', services: [] }));
  assert.equal((await getOrderDetail(a, bareId)).pricePending, true);

  const full = flexibleOrderSchema.parse({ idempotencyKey: randomUUID(), client: { mode: 'new', kind: 'legal_entity', name: 'Компания Контакты' },
    phones: [{ label: 'Диспетчер', phone: '+7 926 496-15-05' }],
    contacts: [
      { name: 'Первый сотрудник', phone: '+7 926 496-15-06', phones: [{ label: 'Личный', phone: '+7 926 496-15-07' }] },
      { name: 'Второй сотрудник', email: 'second@example.invalid' },
    ],
    objects: [{ name: 'Корпус А', areaSquareMeters: '24198,87' }, { name: 'Корпус Б', address: 'Москва, улица Примерная, 1' }],
    services: [{ name: 'Выезд на объект', quantity: '1', unitPrice: '' }],
    visit: { localDate: '2026-10-06', localTime: '10:00', arrivalMode: 'fixed', endTime: null },
  });
  const fullId = await createFlexibleOrder(a, full);
  const fullDetail = await getOrderDetail(a, fullId);
  assert.equal(fullDetail.relatedContacts.length, 2);
  assert.equal(fullDetail.relatedObjects.length, 2);
  assert.equal(fullDetail.pricePending, true);
  assert.equal(fullDetail.services[0].pricePending, true);
  await updateOrder(a, updateOrderSchema.parse({ orderId: fullId, expectedVersion: 1, status: 'scheduled',
    statusReason: '', assignedMasterId: '', masterPayment: '', notes: '', agreedTotal: '0',
    services: [{ existingLineId: fullDetail.services[0].id, catalogItemId: null, name: 'Выезд на объект', quantity: '1', unitPrice: '', note: '' }] }));
  const pendingDetail = await getOrderDetail(a, fullId);
  assert.equal(pendingDetail.services[0].pricePending, true);
  await updateOrder(a, updateOrderSchema.parse({ orderId: fullId, expectedVersion: 2, status: 'scheduled',
    statusReason: '', assignedMasterId: '', masterPayment: '', notes: '', agreedTotal: '75',
    services: [{ existingLineId: pendingDetail.services[0].id, catalogItemId: null, name: 'Выезд на объект', quantity: '1', unitPrice: '75', note: '' }] }));
  const pricedDetail = await getOrderDetail(a, fullId);
  assert.equal(pricedDetail.pricePending, false);
  assert.equal(pricedDetail.services[0].pricePending, false);
  assert.equal(pricedDetail.services[0].lineTotalMinor, 7500);
  const [fixedVisit] = await sql`SELECT arrival_mode, scheduled_start_at, scheduled_end_at FROM service_visits WHERE order_id = ${fullId}`;
  assert.equal(fixedVisit.arrival_mode, 'fixed');
  assert.equal((fixedVisit.scheduled_end_at - fixedVisit.scheduled_start_at) / 60000, 120);
  const [savedArea] = await sql`SELECT area_square_meters::text AS area FROM client_objects WHERE id = (SELECT object_id FROM orders WHERE id = ${fullId})`;
  assert.equal(Number(savedArea.area), 24198.87);
  const [reminder] = await sql`SELECT id FROM tasks WHERE related_order_id = ${fullId} AND source = 'visit_reminder'`;
  assert.ok(reminder?.id);
  const [fullRow] = await sql`SELECT client_id FROM orders WHERE id = ${fullId}`;
  const client = await getClientDetail(a, fullRow.client_id);
  assert.equal(client.contacts.length, 2);
  assert.equal(client.objects.length, 2);
  assert.equal(client.phoneNumbers.length, 2);
  await completeClientContact(a, { clientId: fullRow.client_id, contactId: client.contacts[1].id, fullName: 'Второй сотрудник', position: 'Координатор', phone: '+7 926 496-15-08', email: 'second@example.invalid' });
  await completeClientObject(a, { clientId: fullRow.client_id, objectId: client.objects.find((entry) => entry.name === 'Корпус А').id, name: 'Корпус А', address: 'Москва, улица Примерная, 2' });
  const completed = await getOrderDetail(a, fullId);
  assert.equal(completed.relatedContacts.find((entry) => entry.name === 'Второй сотрудник').phone, '+7 926 496-15-08');
  assert.equal(completed.relatedObjects.find((entry) => entry.name === 'Корпус А').address, 'Москва, улица Примерная, 2');
  const contractObjectId = client.objects.find((entry) => entry.name === 'Корпус А').id;
  const otherObjectId = client.objects.find((entry) => entry.name === 'Корпус Б').id;
  const [catalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${a.organizationId}, 'service', 'Обработка', 'м²', 'fixed', 100) RETURNING id`;
  await sql`INSERT INTO object_service_profiles (organization_id, object_id, area_square_meters)
    VALUES (${a.organizationId}, ${contractObjectId}, 125.50)`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${a.organizationId}, ${contractObjectId}, ${catalog.id}, 'Обработка по договору', 'contract', 'area', 75, 1)`;
  const contractInput = { client: { mode: 'existing', clientId: fullRow.client_id }, existingObjectIds: [contractObjectId],
    services: [{ catalogItemId: catalog.id, name: 'Обработка по договору', quantity: '125,5', unitPrice: '0,75' }] };
  const contractedId = await createFlexibleOrder(a, flexibleOrderSchema.parse({ ...contractInput, idempotencyKey: randomUUID() }));
  const [contractedLine] = await sql`SELECT catalog_item_id, service_name_snapshot, unit_snapshot, line_total_minor FROM order_services WHERE order_id = ${contractedId}`;
  assert.equal(contractedLine.catalog_item_id, catalog.id);
  assert.equal(contractedLine.service_name_snapshot, 'Обработка по договору');
  assert.equal(contractedLine.unit_snapshot, 'м²');
  assert.equal(Number(contractedLine.line_total_minor), 9413);
  await assert.rejects(createFlexibleOrder(a, flexibleOrderSchema.parse({ ...contractInput, idempotencyKey: randomUUID(), existingObjectIds: [otherObjectId] })), FlexibleOrderReferenceError);
  await assert.rejects(createFlexibleOrder(a, flexibleOrderSchema.parse({ ...contractInput, idempotencyKey: randomUUID(), services: [{ ...contractInput.services[0], name: 'Чужая услуга' }] })), FlexibleOrderReferenceError);
  await sql`UPDATE catalog_items SET name = 'Обработка — новое название' WHERE id = ${catalog.id}`;
  const [catalogVersion] = await sql`SELECT version FROM catalog_items WHERE id = ${catalog.id}`;
  assert.equal(await deleteCatalogItem(a, catalog.id, catalogVersion.version), 'archived');
  const archivedContractId = await createFlexibleOrder(a, flexibleOrderSchema.parse({ ...contractInput, idempotencyKey: randomUUID() }));
  const [archivedContractLine] = await sql`SELECT catalog_item_id, line_total_minor FROM order_services WHERE order_id = ${archivedContractId}`;
  assert.equal(archivedContractLine.catalog_item_id, catalog.id);
  assert.equal(Number(archivedContractLine.line_total_minor), 9413);
  const contracted = await getOrderDetail(a, contractedId);
  await updateOrder(a, updateOrderSchema.parse({ orderId: contractedId, expectedVersion: 1, status: 'new',
    statusReason: '', assignedMasterId: '', masterPayment: '', notes: '', agreedTotal: '0',
    services: [{ existingLineId: contracted.services[0].id, catalogItemId: catalog.id, name: 'Обработка по договору', quantity: '125,5', unitPrice: '0,75', note: '' }] }));
  assert.equal((await getOrderDetail(a, contractedId)).services[0].name, 'Обработка по договору');
  const windowOrder = flexibleOrderSchema.parse({ idempotencyKey: randomUUID(), client: { mode: 'existing', clientId: fullRow.client_id },
    existingObjectIds: [client.objects.find((entry) => entry.name === 'Корпус Б').id],
    visit: { localDate: '2026-10-07', localTime: '09:30', arrivalMode: 'window', endTime: '11:00' },
  });
  const windowId = await createFlexibleOrder(a, windowOrder);
  const [windowVisit] = await sql`SELECT arrival_mode, scheduled_start_at, scheduled_end_at FROM service_visits WHERE order_id = ${windowId}`;
  assert.equal(windowVisit.arrival_mode, 'window');
  assert.equal((windowVisit.scheduled_end_at - windowVisit.scheduled_start_at) / 60000, 90);
  await assert.rejects(createFlexibleOrder(b, flexibleOrderSchema.parse({ idempotencyKey: randomUUID(), client: { mode: 'existing', clientId: fullRow.client_id } })), FlexibleOrderReferenceError);
});
