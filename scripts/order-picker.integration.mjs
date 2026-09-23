import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to an isolated PostgreSQL instance.");
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
    if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", root), { namedExports: { getDatabase: () => sql } });
const { listOrderCreationOptions } = await import("../src/server/orders/repository.ts");
const { searchOrderPicker } = await import("../src/server/orders/option-picker.ts");
const { orderPickerQuerySchema } = await import("../src/lib/order-picker.ts");

test("order pickers reach records beyond the initial page without crossing organizations", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_order_picker_${randomUUID().replaceAll("-", "")}`;
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

  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Picker A', 'Europe/Moscow') RETURNING id`;
  const [other] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Picker B', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Editor', 'picker@example.invalid', 'admin') RETURNING id`;
  const member = { organizationId: organization.id, memberId: person.id, role: "admin", permissionOverrides: {} };
  let targetClientId;
  for (let index = 0; index < 25; index += 1) {
    const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
      VALUES (${organization.id}, ${index === 24 ? "Янтарный клиент Ёж" : `Клиент ${String(index).padStart(2, "0")}`}, 'individual') RETURNING id`;
    if (index === 24) targetClientId = client.id;
  }
  await sql`INSERT INTO clients (organization_id, legal_name, kind) VALUES (${other.id}, 'Чужой клиент Ёж', 'individual')`;
  let targetObjectId;
  let targetContactId;
  let targetMasterId;
  for (let index = 0; index < 25; index += 1) {
    const last = index === 24;
    const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
      VALUES (${organization.id}, ${targetClientId}, ${last ? "Янтарный объект Ёж" : `Объект ${String(index).padStart(2, "0")}`}, 'Office', ${`Test address ${index}`}) RETURNING id`;
    const phone = `+7999000${String(index).padStart(4, "0")}`;
    const [contact] = await sql`INSERT INTO client_contacts (organization_id, client_id, full_name, phone, normalized_phone)
      VALUES (${organization.id}, ${targetClientId}, ${last ? "Янтарный контакт Ёж" : `Контакт ${String(index).padStart(2, "0")}`}, ${phone}, ${phone}) RETURNING id`;
    const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
      VALUES (${organization.id}, ${last ? "Янтарный мастер Ёж" : `Мастер ${String(index).padStart(2, "0")}`}, ${phone}, ${phone}, 'Москва', 'Москва') RETURNING id`;
    if (last) { targetObjectId = object.id; targetContactId = contact.id; targetMasterId = master.id; }
  }
  await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone) VALUES (${other.id}, 'Чужой мастер Ёж', '+79991111111', '+79991111111', 'Москва', 'Москва')`;

  const initial = await listOrderCreationOptions(member);
  assert.equal(initial.clients.length, 20);
  assert.equal(initial.masters.length, 20);
  assert.equal(initial.objects.length, 0);
  const focused = await listOrderCreationOptions(member, targetClientId);
  assert.equal(focused.clients.length, 21);
  assert.ok(focused.clients.some((client) => client.id === targetClientId));
  assert.equal(focused.objects.length, 20);
  assert.equal(focused.contacts.length, 20);
  assert.ok(!focused.objects.some((item) => item.id === targetObjectId));

  for (const [type, id] of [["clients", targetClientId], ["objects", targetObjectId], ["contacts", targetContactId], ["masters", targetMasterId]]) {
    const base = { type, ...(type === "objects" || type === "contacts" ? { clientId: targetClientId } : {}) };
    const first = await searchOrderPicker(member, orderPickerQuerySchema.parse(base));
    assert.equal(first.items.length, 20, `${type} first page`);
    assert.equal(first.hasMore, true, `${type} has more`);
    const found = await searchOrderPicker(member, orderPickerQuerySchema.parse({ ...base, q: "еж" }));
    assert.deepEqual(found.items.map((item) => item.id), [id], `${type} search beyond first page`);
  }
  const foreignClient = await searchOrderPicker(member, orderPickerQuerySchema.parse({ type: "clients", q: "чужой" }));
  assert.deepEqual(foreignClient.items, []);
  const foreignMaster = await searchOrderPicker(member, orderPickerQuerySchema.parse({ type: "masters", q: "чужой" }));
  assert.deepEqual(foreignMaster.items, []);
  const scoped = await searchOrderPicker(member, orderPickerQuerySchema.parse({ type: "objects", clientId: randomUUID(), q: "еж" }));
  assert.deepEqual(scoped.items, []);
});
