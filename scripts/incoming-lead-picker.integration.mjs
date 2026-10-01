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
const { getIncomingLeadSnapshot, getIncomingLeadPrefill, getOrderCreatedFromIncomingLead, searchIncomingLeadOptions, rejectIncomingLead } = await import("../src/server/incoming-leads/repository.ts");

test("inbox picker searches beyond the initial 250 leads and keeps organization boundaries", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_lead_picker_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll(); hooks.deregister(); await sql.end();
    try { await admin`DROP DATABASE ${admin(databaseName)}`; } finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  async function makeMember(name, email) {
    const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES (${name}, 'Europe/Moscow') RETURNING id`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, ${name}, ${email}, 'admin') RETURNING id`;
    const [site] = await sql`INSERT INTO websites (organization_id, name, domain, status)
      VALUES (${organization.id}, ${name}, ${`${name.toLowerCase().replaceAll(" ", "-")}.example.test`}, 'active') RETURNING id`;
    return {
      member: { sessionId: null, organizationId: organization.id, organizationName: name, memberId: person.id,
        displayName: name, email, role: "admin", masterId: null, permissionOverrides: {} },
      siteId: site.id,
    };
  }
  const a = await makeMember("Picker A", "picker-a@example.test");
  const b = await makeMember("Picker B", "picker-b@example.test");
  await sql`INSERT INTO website_leads (organization_id, website_id, external_event_id, received_at,
      contact_name, phone, service_interest, payload_fingerprint, moderation_status)
    SELECT ${a.member.organizationId}, ${a.siteId}, 'event-' || n,
      now() - n * interval '1 minute', CASE WHEN n = 270 THEN 'Очень старая заявка' ELSE 'Клиент ' || n END,
      CASE WHEN n = 270 THEN '+79991234567' ELSE NULL END,
      CASE WHEN n = 270 THEN 'Дезинфекция склада' ELSE 'Обычная услуга' END,
      'fingerprint-' || n, CASE WHEN n = 270 THEN 'reviewing' ELSE 'new' END
    FROM generate_series(1, 270) AS n`;
  await sql`INSERT INTO website_leads (organization_id, website_id, external_event_id, received_at,
      contact_name, payload_fingerprint)
    VALUES (${b.member.organizationId}, ${b.siteId}, 'private-event', now(), 'Секретная заявка', 'private-fingerprint')`;

  const snapshot = await getIncomingLeadSnapshot(a.member, { status: "all", query: "" });
  assert.equal(snapshot.leads.length, 250);
  assert.equal(snapshot.leads.some((lead) => lead.contactName === "Очень старая заявка"), false);

  const byName = await searchIncomingLeadOptions(a.member, { status: "all", query: "Очень старая" });
  assert.equal(byName.items.length, 1);
  assert.equal(byName.items[0].name, "Очень старая заявка");
  const byPhone = await searchIncomingLeadOptions(a.member, { status: "reviewing", query: "1234567" });
  assert.equal(byPhone.items[0]?.id, byName.items[0].id);
  const byService = await searchIncomingLeadOptions(a.member, { status: "reviewing", query: "Дезинфекция" });
  assert.equal(byService.items[0]?.id, byName.items[0].id);
  const wrongStatus = await searchIncomingLeadOptions(a.member, { status: "new", query: "Очень старая" });
  assert.equal(wrongStatus.items.length, 0);
  const firstPage = await searchIncomingLeadOptions(a.member, { status: "all", query: "" });
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.hasMore, true);
  const privateLead = await searchIncomingLeadOptions(a.member, { status: "all", query: "Секретная" });
  assert.equal(privateLead.items.length, 0);
  const otherSide = await searchIncomingLeadOptions(b.member, { status: "all", query: "Секретная" });
  assert.equal(otherSide.items.length, 1);

  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${a.member.organizationId}, 'Клиент старой заявки', 'individual') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, source_lead_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${a.member.organizationId}, ${client.id}, ${byName.items[0].id}, 'LEAD-001', 'new', 'RUB',
      'Клиент старой заявки', '', '') RETURNING id`;
  await sql`UPDATE website_leads SET moderation_status = 'accepted', reviewed_by = ${a.member.memberId}, reviewed_at = now()
    WHERE organization_id = ${a.member.organizationId} AND id = ${byName.items[0].id}`;
  const activeSnapshot = await getIncomingLeadSnapshot(a.member, { status: "active", query: "Очень старая" });
  assert.equal(activeSnapshot.leads.length, 0);
  assert.equal((await getIncomingLeadSnapshot(a.member, { status: "accepted", query: "Очень старая" })).leads[0].orderId, order.id);
  assert.equal((await searchIncomingLeadOptions(a.member, { status: "active", query: "Очень старая" })).items.length, 0);
  const [rejectable] = await sql`SELECT id, version FROM website_leads WHERE organization_id = ${a.member.organizationId} AND external_event_id = 'event-1'`;
  await rejectIncomingLead(a.member, { leadId: rejectable.id, expectedVersion: rejectable.version, reason: "Проверка отклонения" });
  assert.equal((await getIncomingLeadSnapshot(a.member, { status: "active", query: "Клиент 1" })).leads.some((lead) => lead.id === rejectable.id), false);
  assert.equal((await getIncomingLeadSnapshot(a.member, { status: "rejected", query: "Клиент 1" })).leads[0].reviewNote, "Проверка отклонения");
  await assert.rejects(getIncomingLeadPrefill(a.member, byName.items[0].id));
  assert.equal(await getOrderCreatedFromIncomingLead(a.member, byName.items[0].id), order.id);
  assert.equal(await getOrderCreatedFromIncomingLead(b.member, byName.items[0].id), null);
});
