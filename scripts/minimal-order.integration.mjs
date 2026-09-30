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
const { createMinimalOrder, minimalOrderSchema } = await import("../src/server/quick-order/minimal.ts");
const { resolveCenterOrderScope } = await import("../src/server/organizations/center-dashboard.ts");
const { centerRecordIsAccessible } = await import("../src/server/organizations/center-feed.ts");
const { getOrderDetail } = await import("../src/server/orders/repository.ts");
const { createDocument, getOrderDocumentUploadOptions, listOrderDocuments, listDocuments, getDocumentArchiveTree, getDocumentBatchExport } = await import("../src/server/documents/repository.ts");

test("a customer name alone creates a resumable order without changing its organization", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_minimal_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll(); hooks.deregister();
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Order Test', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Test Owner', 'order-test@example.invalid', 'admin') RETURNING id`;
  const member = { sessionId: null, organizationId: organization.id, organizationName: 'Order Test', memberId: person.id,
    displayName: 'Test Owner', email: 'order-test@example.invalid', role: 'admin', masterId: null, permissionOverrides: {} };
  const input = minimalOrderSchema.parse({ idempotencyKey: randomUUID(), clientKind: 'legal_entity',
    clientName: 'Комбинат питания Подольск', phone: '+7 926 496-15-05', price: '12000',
    contactName: 'Ленар', email: '', taxId: '' });
  const orderId = await createMinimalOrder(member, input);
  assert.equal(await createMinimalOrder(member, input), orderId);
  const [order] = await sql`SELECT organization_id, object_id, client_name_snapshot, contact_name_snapshot,
    agreed_total_minor, client_contact_id FROM orders WHERE id = ${orderId}`;
  assert.equal(order.organization_id, organization.id);
  assert.equal(order.object_id, null);
  assert.equal(order.client_name_snapshot, 'Комбинат питания Подольск');
  assert.equal(order.contact_name_snapshot, 'Ленар');
  assert.equal(Number(order.agreed_total_minor), 1_200_000);
  assert.ok(order.client_contact_id);
  const nameOnly = minimalOrderSchema.parse({ idempotencyKey: randomUUID(), clientKind: 'individual',
    clientName: 'Иван Петров', phone: '', price: '', contactName: '', email: '', taxId: '' });
  const nameOnlyId = await createMinimalOrder(member, nameOnly);
  const [nameOnlyOrder] = await sql`SELECT client_contact_id, agreed_total_minor, price_pending FROM orders WHERE id = ${nameOnlyId}`;
  assert.equal(nameOnlyOrder.client_contact_id, null);
  assert.equal(Number(nameOnlyOrder.agreed_total_minor), 0);
  assert.equal(nameOnlyOrder.price_pending, true);

  const uploadOptions = await getOrderDocumentUploadOptions(member, nameOnlyId);
  assert.equal(uploadOptions.orders.find((item) => item.id === nameOnlyId)?.objectId, null);
  const documentId = randomUUID();
  assert.equal(await createDocument(member, {
    idempotencyKey: documentId, orderId: nameOnlyId, visitId: null, contractId: null,
    title: 'Договор без объекта', category: 'contract', description: null,
    filename: 'contract.pdf', mimeType: 'application/pdf', extension: 'pdf',
    sizeBytes: 3, sha256: 'a'.repeat(64), storageKey: `documents/${documentId}/contract.pdf`,
  }), documentId);
  assert.equal((await listOrderDocuments(member, nameOnlyId))[0]?.id, documentId);
  const archiveTree = await getDocumentArchiveTree(member);
  assert.equal(archiveTree.documentCount, 1);
  assert.equal(archiveTree.clients[0]?.objects[0]?.name, 'Без объекта');
  assert.equal((await listDocuments(member, { clientId: null, objectId: nameOnlyId, orderId: nameOnlyId, category: null, folderId: null, favoriteOnly: false }))[0]?.id, documentId);
  assert.equal((await getDocumentBatchExport(member, [documentId]))[0]?.documentId, documentId);

  const [center] = await sql`INSERT INTO organizations (name, timezone, organization_kind)
    VALUES ('Center Test', 'Europe/Moscow', 'center') RETURNING id`;
  const [centerPerson] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${center.id}, 'Center Owner', 'center-owner@example.invalid', 'admin') RETURNING id`;
  const [session] = await sql`INSERT INTO auth_sessions (organization_id, member_id, token_hash, expires_at)
    VALUES (${center.id}, ${centerPerson.id}, ${'a'.repeat(64)}, now() + interval '1 day') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${center.id}, ${centerPerson.id}, ${organization.id}, ${person.id})`;
  const centerMember = { ...member, sessionId: session.id, organizationId: center.id, organizationName: 'Center Test', memberId: centerPerson.id };
  assert.equal(await centerRecordIsAccessible(centerMember, 'order', organization.id, orderId), true);
  const scope = await resolveCenterOrderScope(centerMember, orderId);
  assert.equal(scope?.organizationId, organization.id);
  assert.equal((await getOrderDetail(scope, orderId)).client, 'Комбинат питания Подольск');
  const [unchangedSession] = await sql`SELECT active_organization_id FROM auth_sessions WHERE id = ${session.id}`;
  assert.equal(unchangedSession.active_organization_id, null);

  const [ungranted] = await sql`INSERT INTO organizations (name, timezone, organization_kind)
    VALUES ('Ungrant Test', 'Europe/Moscow', 'company') RETURNING id`;
  const [ungrantedPerson] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${ungranted.id}, 'Other Admin', 'other-admin@example.invalid', 'admin') RETURNING id`;
  const ungrantedMember = { ...member, organizationId: ungranted.id, organizationName: 'Ungrant Test', memberId: ungrantedPerson.id };
  const ungrantedOrderId = await createMinimalOrder(ungrantedMember, minimalOrderSchema.parse({
    ...nameOnly, idempotencyKey: randomUUID(), clientName: 'Скрытый заказ',
  }));
  assert.equal(await centerRecordIsAccessible(centerMember, 'order', ungranted.id, ungrantedOrderId), false);
  assert.equal(await resolveCenterOrderScope(centerMember, ungrantedOrderId), null);
  await assert.rejects(getOrderDetail(centerMember, ungrantedOrderId));
});
