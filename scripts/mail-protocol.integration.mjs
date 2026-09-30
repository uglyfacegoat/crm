import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { spawn } from 'node:child_process';
import { mock, test } from 'node:test';
import { once } from 'node:events';
import net from 'node:net';
import postgres from 'postgres';
import PostalMime from 'postal-mime';
import { runMigrations } from './migrate.mjs';
import { startMailFixture } from './fixtures/mail-server.mjs';

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

test('worker receives IMAP MIME and delivers real SMTP STARTTLS replies despite an unavailable mailbox', { timeout: 60_000 }, async t => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_mail_protocol_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  const peer = await startMailFixture();
  const unavailable = net.createServer(socket => socket.destroy());
  unavailable.listen(0, '127.0.0.1'); await once(unavailable, 'listening');
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await peer.close();
    await new Promise(done => unavailable.close(done)); await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Protocol fixture', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${org.id}, 'Mail coordinator', 'coordinator@fixture.invalid', 'crm_coordinator') RETURNING id`;
  const [source] = await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${org.id}, 'office@fixture.invalid', 'Office') RETURNING id`;
  await sql`INSERT INTO mail_sources (organization_id, address, display_name)
    VALUES (${org.id}, 'offline@fixture.invalid', 'Offline')`;
  const member = { organizationId: org.id, memberId: person.id, role: 'crm_coordinator', permissionOverrides: {} };
  const mailbox = { address: 'office@fixture.invalid', imapHost: '127.0.0.1', imapPort: peer.imapPort,
    imapUser: peer.auth.user, imapPassword: peer.auth.password, tlsServername: 'localhost',
    smtpHost: '127.0.0.1', smtpPort: peer.smtpPort, smtpUser: peer.auth.user, smtpPassword: peer.auth.password };
  const offline = { ...mailbox, address: 'offline@fixture.invalid', imapPort: unavailable.address().port };
  async function cycle(accounts = [mailbox]) {
    const child = spawn(process.execPath, ['scripts/mail-worker.mjs', '--once'], { env: { ...process.env,
      DATABASE_URL: url.toString(), NODE_EXTRA_CA_CERTS: peer.certPath,
      CRM_MAIL_ORGANIZATION_ID: org.id, CRM_MAIL_ACCOUNTS_JSON: JSON.stringify(accounts),
      CRM_MAIL_OUTBOUND_ENABLED: 'true', AUTH_EMAIL_OTP_ENABLED: 'false', CRM_MAIL_SMTP_HOST: '', CRM_MAIL_FROM: '',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostics = ''; child.stderr.on('data', chunk => { diagnostics += chunk; });
    const kill = setTimeout(() => child.kill('SIGTERM'), 20_000);
    const [code] = await once(child, 'exit'); clearTimeout(kill);
    assert.equal(code, 0, diagnostics);
    return (await sql`SELECT status, last_result FROM background_job_status WHERE job_name = 'mail.inbox'`)[0];
  }
  peer.inbox.push(Buffer.from('From: client@fixture.invalid\r\nTo: office@fixture.invalid\r\nSubject: Protocol request\r\nMessage-ID: <client-root@fixture.invalid>\r\n\r\nWhen can you visit?'));
  assert.equal((await cycle()).last_result.imported, 1);
  const [incoming] = await sql`SELECT id, internet_message_id, body_text FROM mail_messages`;
  assert.equal(incoming.internet_message_id, '<client-root@fixture.invalid>');
  assert.equal(incoming.body_text.trim(), 'When can you visit?');
  const input = { sourceId: source.id, toAddress: 'client@fixture.invalid', subject: 'Re: Protocol request', bodyText: 'Confirmed visit', replyToMessageId: incoming.id, requestKey: randomUUID() };
  const replyId = await queueOutgoingMail(member, input);
  const withOutage = await cycle([offline, mailbox]);
  assert.equal(withOutage.status, 'failed', 'Unavailable mailbox is reported');
  assert.equal(withOutage.last_result.outboxSent, 1, 'IMAP failure must not starve SMTP');
  assert.equal(peer.delivered.length, 1);
  const parsed = await PostalMime.parse(peer.delivered[0]);
  assert.equal(parsed.messageId, `<crm-outbox-${replyId}@fixture.invalid>`);
  assert.equal(parsed.inReplyTo, '<client-root@fixture.invalid>');
  assert.equal(parsed.references, '<client-root@fixture.invalid>');
  assert.equal(parsed.text.trim(), 'Confirmed visit');
  assert.equal((await sql`SELECT status FROM mail_outbox WHERE id = ${replyId}`)[0].status, 'sent');
  peer.inbox.push(Buffer.from(`From: client@fixture.invalid\r\nTo: office@fixture.invalid\r\nSubject: Re: Protocol request\r\nMessage-ID: <client-confirmation@fixture.invalid>\r\nIn-Reply-To: ${parsed.messageId}\r\nReferences: <client-root@fixture.invalid> ${parsed.messageId}\r\n\r\nThank you`));
  const receivedWithOutage = await cycle([offline, mailbox]);
  assert.equal(receivedWithOutage.last_result.imported, 1, 'Other mailbox still imports despite earlier failure');
  assert.equal((await getMailThread(member, { id: incoming.id, folder: 'inbox', page: 0 })).total, 3);
  assert.equal((await sql`SELECT count(*)::integer AS total FROM mail_messages`)[0].total, 2);
  assert.equal(peer.delivered.length, 1, 'Already-sent message is not sent again');
  const retryId = await queueOutgoingMail(member, { ...input, bodyText: 'Retry after SMTP outage', requestKey: randomUUID() });
  peer.rejectDelivery(true); await cycle();
  assert.equal((await sql`SELECT status FROM mail_outbox WHERE id = ${retryId}`)[0].status, 'pending');
  assert.equal(peer.delivered.length, 1);
  peer.rejectDelivery(false);
  await sql`UPDATE mail_outbox SET next_attempt_at = now() WHERE id = ${retryId}`;
  await cycle();
  assert.equal((await sql`SELECT status FROM mail_outbox WHERE id = ${retryId}`)[0].status, 'sent');
  assert.equal(peer.delivered.length, 2);
  const stale = await queueOutgoingMail(member, { ...input, bodyText: 'Unconfirmed old attempt', requestKey: randomUUID() });
  await sql`UPDATE mail_outbox SET status = 'sending', attempts = 8, locked_at = now() - interval '10 minutes' WHERE id = ${stale}`;
  await cycle();
  assert.equal((await sql`SELECT status, last_error_code FROM mail_outbox WHERE id = ${stale}`)[0].last_error_code, 'MAIL_DELIVERY_UNCONFIRMED');
  assert.equal(peer.delivered.length, 2);
});
