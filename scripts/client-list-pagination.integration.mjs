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
const { listClientsPage } = await import("../src/server/clients/repository.ts");
const { clientListQuerySchema } = await import("../src/lib/client-list.ts");

test("client list reaches older rows, filters across all rows, and isolates organizations", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_client_pages_${randomUUID().replaceAll("-", "")}`;
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

  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Clients A', 'Europe/Moscow') RETURNING id`;
  const [other] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Clients B', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Reader', 'reader@example.invalid', 'admin') RETURNING id`;
  const member = { organizationId: organization.id, memberId: person.id, role: "admin", permissionOverrides: {} };
  let targetId;
  for (let index = 0; index < 230; index += 1) {
    const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind, tax_id)
      VALUES (${organization.id}, ${index === 229 ? "Особый клиент Ёж" : `Клиент ${String(index).padStart(3, "0")}`},
      ${index === 229 ? "individual" : "legal_entity"}, ${index === 229 ? "990099" : null}) RETURNING id`;
    if (index === 229) targetId = client.id;
  }
  await sql`INSERT INTO clients (organization_id, legal_name, kind) VALUES (${other.id}, 'Чужой клиент Ёж', 'individual')`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organization.id}, ${targetId}, 'Объект Ёж', 'Office', 'Test address') RETURNING id`;
  await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, agreed_total_minor)
    VALUES (${organization.id}, ${targetId}, ${object.id}, 'CLIENT-PAGE-1', 'new', 'RUB',
      'Особый клиент Ёж', 'Объект Ёж', 'Test address', 0)`;
  const defaults = clientListQuerySchema.parse({});
  const ids = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await listClientsPage(member, { ...defaults, page });
    assert.equal(result.total, 230);
    assert.equal(result.summary.total, 230);
    assert.ok(result.items.length <= 50);
    ids.push(...result.items.map((item) => item.id));
  }
  assert.equal(ids.length, 230);
  assert.equal(new Set(ids).size, 230);
  assert.ok(ids.includes(targetId));
  const searched = await listClientsPage(member, { ...defaults, q: "еж" });
  assert.deepEqual(searched.items.map((item) => item.id), [targetId]);
  const filtered = await listClientsPage(member, { ...defaults, kind: "Физ. лицо" });
  assert.deepEqual(filtered.items.map((item) => item.id), [targetId]);
  const byTax = await listClientsPage(member, { ...defaults, q: "990099" });
  assert.deepEqual(byTax.items.map((item) => item.id), [targetId]);
  const active = await listClientsPage(member, { ...defaults, history: "with-orders", minOrders: 1, minObjects: 1 });
  assert.deepEqual(active.items.map((item) => item.id), [targetId]);
  assert.equal(active.summary.active, 1);
  assert.equal(active.summary.objects, 1);
  assert.equal(active.summary.orders, 1);
  const inactive = await listClientsPage(member, { ...defaults, history: "without-orders" });
  assert.equal(inactive.total, 229);
  const sorted = await listClientsPage(member, { ...defaults, sort: "orders-desc" });
  assert.equal(sorted.items[0].id, targetId);
});
