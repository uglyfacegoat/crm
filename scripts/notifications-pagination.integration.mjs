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
  if (context.parentURL?.startsWith(root.href) && specifier.startsWith("@/")) {
    return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", root), { namedExports: { getDatabase: () => sql } });
const { listNotifications } = await import("../src/server/notifications/repository.ts");

test("notification pages reach every older row exactly once across timestamp ties and read changes", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_notification_pages_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll(); hooks.deregister();
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Notification pages', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Reader', 'reader@example.invalid', 'admin') RETURNING id`;
  const [colleague] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Colleague', 'colleague@example.invalid', 'admin') RETURNING id`;
  const member = { organizationId: organization.id, memberId: person.id, role: "admin", permissionOverrides: {} };
  const base = Date.now() - 300_000;
  for (let index = 0; index < 125; index += 1) {
    await sql`INSERT INTO notifications (organization_id, recipient_member_id, kind, severity, title, body,
      source_type, source_id, target_type, target_id, event_key, occurred_at)
      VALUES (${organization.id}, ${person.id}, 'task_overdue', 'warning', ${`Notice ${index}`}, 'Test notification',
        'task', ${randomUUID()}, 'task', ${randomUUID()}, ${`notice-${index}`}, ${new Date(base - Math.floor(index / 2) * 1000)})`;
  }
  await sql`INSERT INTO notifications (organization_id, recipient_member_id, kind, severity, title, body,
    source_type, source_id, target_type, target_id, event_key, occurred_at)
    VALUES (${organization.id}, ${colleague.id}, 'task_overdue', 'warning', 'Private notice', 'Colleague only',
      'task', ${randomUUID()}, 'task', ${randomUUID()}, 'colleague-notice', ${new Date(base)})`;

  const expected = (await sql`SELECT id FROM notifications WHERE recipient_member_id = ${person.id}
    ORDER BY occurred_at DESC, id DESC`).map((row) => row.id);
  const collected = [];
  let cursor = null;
  let pageCount = 0;
  do {
    const page = await listNotifications(member, { limit: 25, unreadOnly: false, cursor });
    assert.ok(page.items.length <= 25);
    assert.equal(page.unreadCount, pageCount === 0 ? 125 : 124);
    collected.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    pageCount += 1;
    if (pageCount === 1) await sql`UPDATE notifications SET read_at = now() WHERE id = ${page.items[0].id}`;
  } while (cursor);
  assert.equal(pageCount, 5);
  assert.deepEqual(collected, expected);
  assert.equal(new Set(collected).size, 125);

  const unread = [];
  cursor = null;
  do {
    const page = await listNotifications(member, { limit: 17, unreadOnly: true, cursor });
    unread.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(unread.length, 124);
  assert.equal(new Set(unread).size, 124);
  assert.ok(!unread.includes(expected[0]));
});
