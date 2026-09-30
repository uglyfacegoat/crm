import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) {
  throw new Error("Run this scenario through an isolated PostgreSQL fixture.");
}

test("lead and incoming email remain in CRM while verified destinations receive independent delivery jobs", async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const databaseName = `crm_mail_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const sql = postgres(url.toString(), { max: 2 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(databaseName)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Mail integration test', 'Europe/Moscow') RETURNING id`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Тестовый менеджер', 'manager@example.test', 'manager') RETURNING id`;
  const [site] = await sql`INSERT INTO websites (organization_id, name, domain, status)
    VALUES (${organization.id}, 'Test website', 'example.test', 'active') RETURNING id`;
  const [destination] = await sql`INSERT INTO member_mail_destinations
    (organization_id, member_id, email, verified_at)
    VALUES (${organization.id}, ${member.id}, 'personal@example.test', now()) RETURNING id`;
  const [source] = await sql`INSERT INTO mail_sources (organization_id, website_id, address, display_name)
    VALUES (${organization.id}, ${site.id}, 'info@example.test', 'Первый сайт') RETURNING id`;
  const [otherSource] = await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${organization.id}, 'info@other.test', 'Другой сайт') RETURNING id`;
  await sql`INSERT INTO member_mail_source_subscriptions
    (organization_id, destination_id, source_id, leads_enabled, mail_enabled)
    VALUES (${organization.id}, ${destination.id}, ${source.id}, true, true)`;

  const [lead] = await sql`INSERT INTO website_leads
    (organization_id, website_id, external_event_id, received_at, contact_name, phone, payload_fingerprint)
    VALUES (${organization.id}, ${site.id}, 'test-mail-1', now(), 'Клиент', '+79990000000', 'fingerprint') RETURNING id`;
  const [message] = await sql`INSERT INTO mail_messages
    (organization_id, mailbox_address, uid_validity, imap_uid, from_address, subject, body_text, raw_message, received_at, recipient_address, source_id)
    VALUES (${organization.id}, 'info@example.test', 1, 1, 'client@example.test', 'Запрос', 'Текст запроса', ${Buffer.from('test')}, now(), 'info@example.test', ${source.id}) RETURNING id`;
  const jobs = await sql`SELECT source_type, source_id FROM mail_delivery_jobs
    WHERE destination_id = ${destination.id} ORDER BY source_type`;
  assert.deepEqual(jobs.map((job) => [job.source_type, job.source_id]), [["lead", lead.id], ["mail", message.id]]);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM website_leads WHERE id = ${lead.id}`)[0].count, 1);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM mail_messages WHERE id = ${message.id}`)[0].count, 1);

  const [outgoing] = await sql`INSERT INTO mail_outbox
    (organization_id, source_id, sender_member_id, from_address, to_address, subject, body_text, reply_to_message_id)
    VALUES (${organization.id}, ${source.id}, ${member.id}, 'info@example.test', 'client@example.test',
      'Re: Запрос', 'Ответ клиенту', ${message.id}) RETURNING id, status`;
  assert.equal(outgoing.status, 'pending');
  assert.equal((await sql`SELECT count(*)::integer AS count FROM mail_outbox WHERE id = ${outgoing.id}`)[0].count, 1);
  const [outsideOrganization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Other mail organization', 'Europe/Moscow') RETURNING id`;
  const [outsideSource] = await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${outsideOrganization.id}, 'outside@example.test', 'Чужой ящик') RETURNING id`;
  await assert.rejects(sql`INSERT INTO mail_outbox
    (organization_id, source_id, sender_member_id, from_address, to_address, subject, body_text)
    VALUES (${organization.id}, ${outsideSource.id}, ${member.id}, 'outside@example.test',
      'client@example.test', 'Чужой адрес', 'Недопустимо')`);

  await sql`INSERT INTO mail_messages
    (organization_id, mailbox_address, uid_validity, imap_uid, from_address, subject, body_text, raw_message, received_at, recipient_address, source_id)
    VALUES (${organization.id}, 'info@other.test', 1, 1, 'client@example.test', 'Другой сайт', 'Текст', ${Buffer.from('other')}, now(), 'info@other.test', ${otherSource.id})`;
  assert.equal((await sql`SELECT count(*)::integer AS count FROM mail_delivery_jobs
    WHERE destination_id = ${destination.id}`)[0].count, 2);

  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${organization.id}, ${member.id}, 'leads.read', false)`;
  await sql`INSERT INTO mail_messages
    (organization_id, mailbox_address, uid_validity, imap_uid, from_address, subject, body_text, raw_message, received_at, recipient_address, source_id)
    VALUES (${organization.id}, 'info@example.test', 1, 2, 'client@example.test', 'Второе письмо', 'Текст', ${Buffer.from('test-2')}, now(), 'info@example.test', ${source.id})`;
  assert.equal((await sql`SELECT count(*)::integer AS count FROM mail_delivery_jobs
    WHERE destination_id = ${destination.id}`)[0].count, 2);

  await sql`UPDATE organization_members SET active = false WHERE id = ${member.id}`;
  await sql`INSERT INTO website_leads
    (organization_id, website_id, external_event_id, received_at, contact_name, phone, payload_fingerprint)
    VALUES (${organization.id}, ${site.id}, 'test-mail-2', now(), 'Клиент', '+79990000000', 'fingerprint-2')`;
  assert.equal((await sql`SELECT count(*)::integer AS count FROM mail_delivery_jobs
    WHERE destination_id = ${destination.id}`)[0].count, 2);
});
