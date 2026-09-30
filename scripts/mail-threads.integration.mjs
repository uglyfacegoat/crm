import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { mock, test } from 'node:test';
import postgres from 'postgres';
import PostalMime from 'postal-mime';
import { runMigrations } from './migrate.mjs';
import { saveIncomingMail } from '../src/server/mail/ingest.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || adminUrl !== process.env.CRM_TEST_FIXTURE_URL) throw new Error('Use isolated PostgreSQL.');
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
const { queueOutgoingMail, getMailThread } = await import('../src/server/mail/repository.ts');

test('mail conversations use protocol references, merge late parents and stay within a mailbox', async t => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_threads_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Thread fixture', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${org.id}, 'Thread coordinator', 'coordinator@fixture.invalid', 'crm_coordinator') RETURNING id`;
  const member = { organizationId: org.id, memberId: person.id, role: 'crm_coordinator', permissionOverrides: {} };
  const [source] = await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${org.id}, 'office@fixture.invalid', 'Office') RETURNING id`;
  const [second] = await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${org.id}, 'sales@fixture.invalid', 'Sales') RETURNING id`;
  let uid = 0;
  async function incoming(id, references = '', mailbox = 'office@fixture.invalid', sourceId = source.id, organizationId = org.id) {
    const raw = Buffer.from(`From: customer@fixture.invalid\r\nTo: ${mailbox}\r\nMessage-ID: ${id}\r\nReferences: ${references}\r\nIn-Reply-To: ${references.split(' ').at(-1) || ''}\r\nSubject: Same subject\r\n\r\nBody ${id}`);
    const parsed = await PostalMime.parse(raw);
    return saveIncomingMail(sql, { organizationId, mailbox, validity: 1, uid: ++uid, fromAddress: 'customer@fixture.invalid', fromName: null,
      toAddresses: [mailbox], subject: 'Same subject', bodyText: parsed.text, raw, receivedAt: new Date(), recipientAddress: mailbox, sourceId }, parsed);
  }
  const first = await incoming('<root@fixture.invalid>');
  const unrelated = await incoming('<unrelated@fixture.invalid>');
  const input = { sourceId: source.id, toAddress: 'customer@fixture.invalid', subject: 'Re: Same subject', bodyText: 'Our reply', replyToMessageId: first.id, requestKey: randomUUID() };
  const replies = await Promise.all([queueOutgoingMail(member, input), queueOutgoingMail(member, input)]);
  assert.equal(replies[0], replies[1], 'Concurrent repeat creates one queued letter');
  const [outgoing] = await sql`SELECT * FROM mail_outbox WHERE id = ${replies[0]}`;
  assert.equal(outgoing.in_reply_to, '<root@fixture.invalid>');
  assert.deepEqual(outgoing.reference_ids, ['<root@fixture.invalid>']);
  assert.equal(outgoing.thread_id, first.thread_id);
  assert.match(outgoing.internet_message_id, new RegExp(outgoing.id));
  await assert.rejects(queueOutgoingMail(member, { ...input, bodyText: 'Changed content' }), /MAIL_REQUEST_REUSED/);
  await assert.rejects(queueOutgoingMail(member, { ...input, sourceId: second.id, requestKey: randomUUID() }), /MAIL_REPLY_NOT_FOUND/);
  const response = await incoming('<response@fixture.invalid>', `<root@fixture.invalid> ${outgoing.internet_message_id}`);
  assert.equal(response.thread_id, first.thread_id);
  const sameHeadersOtherMailbox = await incoming('<response@fixture.invalid>', '<root@fixture.invalid>', 'sales@fixture.invalid', second.id);
  assert.notEqual(sameHeadersOtherMailbox.thread_id, first.thread_id);
  let thread = await getMailThread(member, { id: first.id, folder: 'inbox', page: 0 });
  assert.equal(thread.total, 3);
  assert.deepEqual(new Set(thread.items.map(item => item.id)), new Set([first.id, outgoing.id, response.id]));
  assert.ok(!thread.items.some(item => item.id === unrelated.id || item.id === sameHeadersOtherMailbox.id));
  assert.equal((await getMailThread(member, { id: outgoing.id, folder: 'sent', page: 0 })).total, 3);

  const lateChild = await incoming('<late-child@fixture.invalid>', '<late-root@fixture.invalid>');
  const lateLocal = await queueOutgoingMail(member, { ...input, replyToMessageId: lateChild.id, requestKey: randomUUID() });
  const lateRoot = await incoming('<late-root@fixture.invalid>');
  thread = await getMailThread(member, { id: lateRoot.id, folder: 'inbox', page: 0 });
  assert.deepEqual(new Set(thread.items.map(item => item.id)), new Set([lateRoot.id, lateChild.id, lateLocal]));
  for (let index = 0; index < 35; index++) await incoming(`<long-${index}@fixture.invalid>`, '<root@fixture.invalid>');
  const newest = await getMailThread(member, { id: first.id, folder: 'inbox', page: 0 });
  const older = await getMailThread(member, { id: first.id, folder: 'inbox', page: 1 });
  assert.equal(newest.total, 38); assert.equal(newest.items.length, 30); assert.equal(older.items.length, 8);
  assert.equal(new Set([...newest.items, ...older.items].map(item => item.id)).size, 38);
  assert.equal((await getMailThread(member, { id: first.id, folder: 'inbox', page: 2 })).items.length, 0);
  await assert.rejects(getMailThread({ ...member, permissionOverrides: { 'leads.read': false } }, { id: first.id, folder: 'inbox', page: 0 }));
  const [otherOrg] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Foreign threads', 'Europe/Moscow') RETURNING id`;
  const outside = await incoming('<root@fixture.invalid>', '', 'office@fixture.invalid', null, otherOrg.id);
  assert.equal(await getMailThread(member, { id: outside.id, folder: 'inbox', page: 0 }), null);

  // On-demand reply to an old MIME message works before the incremental worker backfill.
  const [historical] = await sql`INSERT INTO mail_messages (organization_id, mailbox_address, uid_validity, imap_uid,
    from_address, subject, body_text, raw_message, received_at, source_id)
    VALUES (${org.id}, 'office@fixture.invalid', 2, 1, 'old@fixture.invalid', 'Legacy', 'Old body',
      ${Buffer.from('Message-ID: <old@fixture.invalid>\r\nReferences: <older@fixture.invalid>\r\n\r\nOld body')}, now(), ${source.id}) RETURNING id`;
  const legacyReply = await queueOutgoingMail(member, { ...input, replyToMessageId: historical.id, requestKey: randomUUID() });
  const [legacy] = await sql`SELECT in_reply_to, reference_ids FROM mail_outbox WHERE id = ${legacyReply}`;
  assert.equal(legacy.in_reply_to, '<old@fixture.invalid>');
  assert.deepEqual(legacy.reference_ids, ['<older@fixture.invalid>', '<old@fixture.invalid>']);
});
