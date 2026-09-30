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
const { listCatalogItems, listCatalogUnits, saveCatalogItem, saveCatalogUnit, deleteCatalogItem, deleteCatalogUnit, setCatalogItemActive, searchCatalogInventory, catalogInventoryQuerySchema, CatalogConflictError } = await import("../src/server/catalog/repository.ts");
const { catalogPickerQuerySchema, searchCatalogPicker } = await import("../src/server/catalog/option-picker.ts");
const { catalogItemSchema } = await import("../src/server/catalog/schemas.ts");
const { createMinimalOrder, minimalOrderSchema } = await import("../src/server/quick-order/minimal.ts");
const { updateOrder } = await import("../src/server/orders/repository.ts");
const { updateOrderSchema } = await import("../src/server/orders/schemas.ts");

test("catalog is organization-scoped, supports variable prices and preserves order snapshots", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_catalog_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  async function member(orgName, email) {
    const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES (${orgName}, 'Europe/Moscow') RETURNING id`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Catalog Owner', ${email}, 'admin') RETURNING id`;
    return { sessionId: null, organizationId: org.id, organizationName: orgName, memberId: person.id, displayName: 'Catalog Owner', email, role: 'admin', masterId: null, permissionOverrides: {} };
  }
  const a = await member("Catalog A", "a@catalog.invalid");
  const b = await member("Catalog B", "b@catalog.invalid");
  assert.equal((await listCatalogUnits(a)).some((unit) => unit.symbol === "км²"), true);
  await saveCatalogUnit(a, { symbol: "сотка", label: "сотка" });
  const customUnit = (await listCatalogUnits(a)).find((unit) => unit.symbol === "сотка");
  assert.ok(customUnit);
  await saveCatalogUnit(a, { id: customUnit.id, expectedVersion: customUnit.version, symbol: "сот.", label: "сотка земли" });
  const renamedUnit = (await listCatalogUnits(a)).find((unit) => unit.symbol === "сот.");
  assert.ok(renamedUnit);
  await deleteCatalogUnit(a, renamedUnit.id, renamedUnit.version);
  assert.equal((await listCatalogUnits(a)).some((unit) => unit.symbol === "сот."), false);
  const variable = catalogItemSchema.parse({ kind: "service", name: "Обработка объекта", description: "По площади", sku: "SERV-1", unit: "м²", priceMode: "variable", defaultPrice: "" });
  const item = await saveCatalogItem(a, variable);
  assert.equal(item.defaultPriceMinor, null);
  assert.equal(item.priceMode, "variable");
  assert.equal((await listCatalogItems(a)).length, 1);
  assert.deepEqual(await listCatalogItems(b), []);
  await assert.rejects(saveCatalogItem(a, variable), CatalogConflictError);
  await assert.rejects(saveCatalogItem(b, { ...variable, id: item.id, expectedVersion: item.version }), CatalogConflictError);
  assert.equal(catalogItemSchema.safeParse({ ...variable, priceMode: "fixed", defaultPrice: "" }).success, false);
  const fixed = await saveCatalogItem(a, catalogItemSchema.parse({ kind: "product", name: "Ловушка", description: "", sku: "TRAP-1", unit: "шт.", priceMode: "fixed", defaultPrice: "250" }));
  assert.equal(fixed.defaultPriceMinor, 25000);

  const orderId = await createMinimalOrder(a, minimalOrderSchema.parse({ idempotencyKey: randomUUID(), clientKind: "legal_entity", clientName: "Тестовый заказчик", phone: "+7 926 496-15-05", price: "12000", contactName: "Тест", email: "", taxId: "" }));
  await sql`INSERT INTO order_services (organization_id, order_id, catalog_item_id, item_kind_snapshot, unit_snapshot, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position) VALUES (${a.organizationId}, ${orderId}, ${item.id}, ${item.kind}, ${item.unit}, ${item.name}, 1, 1200000, 1200000, 1)`;
  const edited = await saveCatalogItem(a, catalogItemSchema.parse({ ...variable, id: item.id, expectedVersion: item.version, name: "Новая обработка", defaultPrice: "15000" }));
  assert.equal(edited.defaultPriceMinor, 1500000);
  const [oldLine] = await sql`SELECT service_name_snapshot, item_kind_snapshot, unit_snapshot, unit_price_minor FROM order_services WHERE order_id = ${orderId}`;
  assert.equal(oldLine.service_name_snapshot, "Обработка объекта");
  assert.equal(oldLine.item_kind_snapshot, "service");
  assert.equal(oldLine.unit_snapshot, "м²");
  assert.equal(Number(oldLine.unit_price_minor), 1200000);
  await setCatalogItemActive(a, item.id, edited.version, false);
  assert.equal((await listCatalogItems(a)).find((entry) => entry.id === item.id).active, false);
  assert.equal((await sql`SELECT count(*)::int AS count FROM order_services WHERE catalog_item_id = ${item.id}`)[0].count, 1);
  const [line] = await sql`SELECT id FROM order_services WHERE order_id = ${orderId}`;
  await updateOrder(a, updateOrderSchema.parse({ orderId, expectedVersion: 1, status: "new", statusReason: "", assignedMasterId: "", masterPayment: "", notes: "", agreedTotal: "12000", services: [{ existingLineId: line.id, catalogItemId: item.id, name: "Обработка объекта", quantity: "1", unitPrice: "12000", note: "Без изменений" }] }));
  const [preserved] = await sql`SELECT catalog_item_id, service_name_snapshot, item_kind_snapshot, unit_snapshot, unit_price_minor FROM order_services WHERE order_id = ${orderId}`;
  assert.equal(preserved.catalog_item_id, item.id);
  assert.equal(preserved.service_name_snapshot, "Обработка объекта");
  assert.equal(preserved.unit_snapshot, "м²");
  assert.equal(Number(preserved.unit_price_minor), 1200000);
  assert.equal(await deleteCatalogItem(a, fixed.id, fixed.version), "deleted");
  assert.equal(await deleteCatalogItem(a, item.id, edited.version + 1), "archived");

  await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    SELECT ${a.organizationId}, 'service', 'А-услуга ' || lpad(n::text, 4, '0'), 'м²', 'fixed', 75
    FROM generate_series(1, 1001) n`;
  const [target] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${a.organizationId}, 'service', 'Янтарная услуга Ёж', 'м²', 'fixed', 75) RETURNING id`;
  await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${b.organizationId}, 'service', 'Чужая услуга Ёж', 'м²', 'fixed', 99)`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${a.organizationId}, 'Договорный заказчик', 'legal_entity') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${a.organizationId}, ${client.id}, 'Договорный объект', 'Office', 'Адрес') RETURNING id`;
  await sql`INSERT INTO object_service_profiles (organization_id, object_id)
    VALUES (${a.organizationId}, ${object.id})`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${a.organizationId}, ${object.id}, ${target.id}, 'Договорная янтарная обработка', 'contract', 'area', 23, 1)`;
  assert.equal((await listCatalogItems(a)).some((entry) => entry.id === target.id), false);
  const inventoryQuery = (input) => catalogInventoryQuerySchema.parse(input);
  const inventoryFirstPage = await searchCatalogInventory([a], inventoryQuery({}));
  assert.equal(inventoryFirstPage.items.length, 50);
  assert.equal(inventoryFirstPage.hasMore, true);
  assert.equal(inventoryFirstPage.activeServiceCount, 1002);
  const inventorySecondPage = await searchCatalogInventory([a], inventoryQuery({ page: 1 }));
  assert.equal(inventorySecondPage.items.length, 50);
  assert.notEqual(inventoryFirstPage.items.at(-1).id, inventorySecondPage.items[0].id);
  const inventoryTarget = await searchCatalogInventory([a], inventoryQuery({ q: 'янтарная' }));
  assert.deepEqual(inventoryTarget.items.map((entry) => entry.id), [target.id]);
  assert.equal(inventoryTarget.items[0].organizationName, 'Catalog A');
  assert.equal((await searchCatalogInventory([a], inventoryQuery({ q: 'чужая' }))).items.length, 0);
  assert.deepEqual((await searchCatalogInventory([a, b], inventoryQuery({ q: 'ёж' }))).items.map((entry) => entry.organizationId).sort(), [a.organizationId, b.organizationId].sort());
  assert.equal((await searchCatalogInventory([a], inventoryQuery({ q: 'Catalog A' }))).items.length, 50);
  await assert.rejects(searchCatalogInventory([{ ...a, permissionOverrides: { 'orders.read': false } }], inventoryQuery({})));
  const firstPage = await searchCatalogPicker(a, catalogPickerQuerySchema.parse({}));
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.hasMore, true);
  const byCatalogName = await searchCatalogPicker(a, catalogPickerQuerySchema.parse({ q: 'янтарная' }));
  assert.deepEqual(byCatalogName.items.map((entry) => entry.id), [target.id]);
  const byContractName = await searchCatalogPicker(a, catalogPickerQuerySchema.parse({ q: 'договорная янтарная', objectId: object.id }));
  assert.deepEqual(byContractName.items.map((entry) => entry.id), [target.id]);
  assert.equal(byContractName.items[0].name, 'Договорная янтарная обработка');
  assert.equal(byContractName.items[0].catalogItem.defaultPriceMinor, 75);
  assert.match(byContractName.items[0].detail, /0\.23 ₽\/м² · по договору/);
  assert.equal((await searchCatalogPicker(a, catalogPickerQuerySchema.parse({ q: 'чужая' }))).items.length, 0);
  await sql`UPDATE catalog_items SET active = false WHERE organization_id = ${a.organizationId} AND id = ${target.id}`;
  assert.equal((await searchCatalogInventory([a], inventoryQuery({ q: 'янтарная' }))).items.length, 0);
  assert.deepEqual((await searchCatalogInventory([a], inventoryQuery({ q: 'янтарная', filter: 'archived' }))).items.map((entry) => entry.id), [target.id]);
  assert.equal((await searchCatalogPicker(a, catalogPickerQuerySchema.parse({ q: 'янтарная' }))).items.length, 0);
  assert.equal((await searchCatalogPicker(a, catalogPickerQuerySchema.parse({ id: target.id }))).items[0].id, target.id);
  await assert.rejects(searchCatalogPicker({ ...a, permissionOverrides: { 'orders.read': false } }, catalogPickerQuerySchema.parse({ q: 'янтарная' })));
});
