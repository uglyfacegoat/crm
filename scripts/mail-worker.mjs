import postgres from "postgres";
import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import nodemailer from "nodemailer";
import { randomInt } from "node:crypto";
import { hashEmailOtpCode } from "../src/server/auth/email-otp-code.mjs";
import { renderCrmEmail } from "../src/server/mail/email-template.mjs";
import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { saveIncomingMail } from "../src/server/mail/ingest.mjs";
import { replyHeaders } from "../src/server/mail/thread-headers.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });
const intervalMs = 30_000;
const maxMessageBytes = 5 * 1024 * 1024;
const organizationId = process.env.CRM_MAIL_ORGANIZATION_ID;
function configuredMailboxes() {
  if (process.env.CRM_MAIL_ACCOUNTS_JSON) {
    const value = JSON.parse(process.env.CRM_MAIL_ACCOUNTS_JSON);
    if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid mailbox configuration');
    const accounts = value.map((account) => ({
      address: String(account.address ?? '').trim().toLowerCase(),
      host: String(account.imapHost ?? '').trim(),
      port: Number(account.imapPort ?? 993),
      user: String(account.imapUser ?? '').trim(),
      password: String(account.imapPassword ?? ''),
      tlsServername: String(account.tlsServername ?? '').trim(),
      smtpHost: String(account.smtpHost ?? '').trim(),
      smtpPort: Number(account.smtpPort ?? 465),
      smtpUser: String(account.smtpUser ?? '').trim(),
      smtpPassword: String(account.smtpPassword ?? ''),
    }));
    if (accounts.some((account) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.address)
      || !account.host || !Number.isInteger(account.port) || account.port < 1 || account.port > 65535
      || !account.user || !account.password)
      || new Set(accounts.map((account) => account.address)).size !== accounts.length) {
      throw new Error('Invalid mailbox configuration');
    }
    return accounts;
  }
  const address = process.env.CRM_MAIL_ADDRESS?.trim().toLowerCase();
  return address && process.env.CRM_MAIL_IMAP_HOST && process.env.CRM_MAIL_IMAP_USER && process.env.CRM_MAIL_IMAP_PASSWORD
    ? [{ address, host: process.env.CRM_MAIL_IMAP_HOST, port: Number(process.env.CRM_MAIL_IMAP_PORT || 993),
      user: process.env.CRM_MAIL_IMAP_USER, password: process.env.CRM_MAIL_IMAP_PASSWORD }] : [];
}
const mailboxes = configuredMailboxes();
const imapReady = Boolean(organizationId && mailboxes.length);
const smtpReady = Boolean(process.env.CRM_MAIL_SMTP_HOST && process.env.CRM_MAIL_SMTP_USER && process.env.CRM_MAIL_SMTP_PASSWORD && process.env.CRM_MAIL_FROM);
const otpEnabled = process.env.AUTH_EMAIL_OTP_ENABLED === "true";
const otpSecret = process.env.AUTH_EMAIL_OTP_SECRET;
const otpReady = otpEnabled && smtpReady && typeof otpSecret === "string" && otpSecret.length >= 32;
const outboundEnabled = process.env.CRM_MAIL_OUTBOUND_ENABLED === "true";

function safeText(value, maximum) { return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum); }
function mailboxAddress(value) { return typeof value?.address === "string" ? value.address.toLowerCase().slice(0, 254) : ""; }
async function syncMailbox(account) {
  const mailbox = account.address;
  const [sourceRecord] = await sql`SELECT id FROM mail_sources
    WHERE organization_id = ${organizationId} AND address = ${mailbox} AND active`;
  if (!sourceRecord) throw new Error('MAIL_SOURCE_NOT_REGISTERED');
  const client = new ImapFlow({ host: account.host,
    port: account.port, secure: true,
    tls: { servername: account.tlsServername || process.env.CRM_MAIL_TLS_SERVERNAME || account.host },
    auth: { user: account.user, pass: account.password },
    logger: false, disableAutoIdle: true, connectionTimeout: 10_000, socketTimeout: 20_000 });
  let imported = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const validity = Number(client.mailbox.uidValidity);
      if (!Number.isSafeInteger(validity) || validity < 1) throw new Error("Invalid IMAP UIDVALIDITY");
      const [state] = await sql`SELECT uid_validity, last_uid FROM mail_sync_state
        WHERE organization_id = ${organizationId} AND mailbox_address = ${mailbox}`;
      const lastUid = state && Number(state.uid_validity) === validity ? Number(state.last_uid) : 0;
      const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter((uid) => uid > lastUid).sort((a, b) => a - b).slice(0, 100);
      for (const uid of uids) {
        const fetched = await client.fetchOne(uid, { envelope: true, internalDate: true, size: true }, { uid: true });
        if (!fetched) continue;
        const oversized = Number(fetched.size ?? 0) > maxMessageBytes;
        const source = oversized ? null : await client.fetchOne(uid, { source: true }, { uid: true });
        const raw = oversized ? Buffer.alloc(0) : Buffer.from(source?.source ?? Buffer.alloc(0));
        if (!oversized && !source?.source) continue;
        if (raw.length > maxMessageBytes) throw new Error("IMAP message exceeded configured size limit");
        const parsed = oversized ? null : await PostalMime.parse(raw);
        const sender = parsed?.from && !('group' in parsed.from) ? parsed.from : null;
        const fromAddress = mailboxAddress(sender) || mailboxAddress(fetched.envelope?.from?.[0]) || "unknown@invalid.local";
        const fromName = safeText(sender?.name || fetched.envelope?.from?.[0]?.name, 200) || null;
        const toAddresses = (parsed?.to ?? []).flatMap((address) => 'group' in address && address.group ? address.group : [address])
          .map(mailboxAddress).filter(Boolean).slice(0, 50);
        const recipientAddress = account.address;
        const subject = safeText(parsed?.subject || fetched.envelope?.subject, 500);
        const bodyText = oversized ? "Письмо больше 5 МБ. Полный текст доступен в основном почтовом ящике."
          : safeText(parsed?.text, 100_000);
        const receivedAt = fetched.internalDate instanceof Date && !Number.isNaN(fetched.internalDate.getTime())
          ? fetched.internalDate : new Date();
        await saveIncomingMail(sql, { organizationId, mailbox, validity, uid, fromAddress, fromName,
          toAddresses, subject, bodyText, raw, receivedAt, recipientAddress, sourceId: sourceRecord?.id ?? null }, parsed);
        imported += 1;
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => client.close()); }
  return imported;
}

async function syncInbox() {
  if (!imapReady) return 0;
  let imported = 0; let failed = false;
  for (const account of mailboxes) {
    try { imported += await syncMailbox(account); }
    catch (error) {
      failed = true;
      console.error(JSON.stringify({ operation: "mail_worker.mailbox", errorCode: safeCliErrorCode(error, "MAIL_IMAP_FAILED") }));
    }
  }
  if (failed) throw Object.assign(new Error("MAIL_IMAP_SYNC_FAILED"), { imported });
  return imported;
}

async function backfillThreadHeaders() {
  const rows = await sql`SELECT * FROM mail_messages WHERE NOT headers_imported ORDER BY created_at, id LIMIT 20`;
  for (const row of rows) {
    let parsed = null;
    try { parsed = await PostalMime.parse(row.raw_message); } catch { /* Preserve malformed historical mail. */ }
    await saveIncomingMail(sql, { organizationId: row.organization_id, mailbox: row.mailbox_address,
      validity: row.uid_validity, uid: row.imap_uid, fromAddress: row.from_address, fromName: row.from_name,
      toAddresses: row.to_addresses, subject: row.subject, bodyText: row.body_text, raw: row.raw_message,
      receivedAt: row.received_at, recipientAddress: row.recipient_address, sourceId: row.source_id }, parsed, false);
  }
}

async function claimDelivery() {
  return sql.begin(async (transaction) => {
    const [job] = await transaction`SELECT job.id FROM mail_delivery_jobs job
      JOIN member_mail_destinations destination ON destination.organization_id = job.organization_id
        AND destination.id = job.destination_id
      JOIN organization_members member ON member.organization_id = destination.organization_id
        AND member.id = destination.member_id
      WHERE ((job.status = 'pending' AND job.next_attempt_at <= now())
        OR (job.status = 'sending' AND job.locked_at < now() - interval '5 minutes'))
        AND member.active
        AND (job.source_type = 'verify' OR destination.verified_at IS NOT NULL)
      ORDER BY job.next_attempt_at, job.created_at, job.id FOR UPDATE OF job SKIP LOCKED LIMIT 1`;
    if (!job) return null;
    const [claimed] = await transaction`UPDATE mail_delivery_jobs
      SET status = 'sending', attempts = attempts + 1, locked_at = now(), updated_at = now()
      WHERE id = ${job.id} RETURNING id, organization_id, destination_id, source_type, source_id,
        verification_token, attempts`;
    return claimed;
  });
}

async function contentFor(job) {
  const [destination] = await sql`SELECT destination.email, destination.verified_at,
      destination.verification_expires_at,
      destination.leads_enabled, destination.mail_enabled, member.active, member.role, member.id AS member_id
    FROM member_mail_destinations destination JOIN organization_members member
      ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE destination.organization_id = ${job.organization_id} AND destination.id = ${job.destination_id}`;
  if (!destination?.active) return null;
  const address = String(destination.email);
  if (job.source_type === 'verify') {
    if (destination.verified_at || !destination.verification_expires_at
      || new Date(destination.verification_expires_at) <= new Date()) return null;
    const origin = process.env.CRM_PUBLIC_ORIGIN;
    if (!origin || !job.verification_token) throw new Error("Verification sender is not configured");
    const link = `${origin}/mail/verify?token=${encodeURIComponent(String(job.verification_token))}`;
    return { to: address, subject: "Подтвердите адрес для копий из CRM", text: `Откройте ссылку и подтвердите адрес:\n${link}\n\nСсылка действует 24 часа.` };
  }
  if (!destination.verified_at) return null;
  const [access] = await sql`SELECT allowed FROM member_permission_overrides
    WHERE organization_id = ${job.organization_id} AND member_id = ${destination.member_id}
      AND permission = 'leads.read'`;
  if (access?.allowed === false || (access?.allowed !== true
    && !['admin', 'manager', 'dispatcher', 'accountant'].includes(destination.role))) return null;
  if (job.source_type === 'lead') {
    if (!destination.leads_enabled) return null;
    const [lead] = await sql`SELECT website_id, contact_name, phone, email, service_interest, object_address,
      object_size, comment FROM website_leads WHERE organization_id = ${job.organization_id} AND id = ${job.source_id}`;
    if (!lead) return null;
    const [subscription] = await sql`SELECT 1 FROM member_mail_source_subscriptions preference
      JOIN mail_sources source ON source.organization_id = preference.organization_id AND source.id = preference.source_id
      WHERE preference.organization_id = ${job.organization_id} AND preference.destination_id = ${job.destination_id}
        AND source.website_id = ${lead.website_id} AND source.active AND preference.leads_enabled LIMIT 1`;
    if (!subscription) return null;
    return { to: address, subject: "Новая заявка с сайта · CRM", text: [
      "Новая заявка сохранена в CRM.", `Клиент: ${safeText(lead.contact_name, 200)}`,
      `Телефон: ${safeText(lead.phone, 80)}`, `Email: ${safeText(lead.email, 254)}`,
      `Услуга: ${safeText(lead.service_interest, 500)}`, `Адрес объекта: ${safeText(lead.object_address, 500)}`,
      `Размер: ${safeText(lead.object_size, 100)}`, `Комментарий: ${safeText(lead.comment, 2000)}`,
      `${process.env.CRM_PUBLIC_ORIGIN}/inbox`,
    ].join("\n") };
  }
  if (!destination.mail_enabled) return null;
  const [message] = await sql`SELECT source_id, recipient_address, from_address, subject, body_text FROM mail_messages
    WHERE organization_id = ${job.organization_id} AND id = ${job.source_id}`;
  if (!message?.source_id) return null;
  const [subscription] = await sql`SELECT 1 FROM member_mail_source_subscriptions preference
    JOIN mail_sources source ON source.organization_id = preference.organization_id AND source.id = preference.source_id
    WHERE preference.organization_id = ${job.organization_id} AND preference.destination_id = ${job.destination_id}
      AND source.id = ${message.source_id} AND source.active AND preference.mail_enabled LIMIT 1`;
  if (!subscription) return null;
  return { to: address, subject: `Копия письма · ${safeText(message.subject, 200)}`,
    text: `Входящее письмо сохранено в CRM.\nНа адрес: ${safeText(message.recipient_address, 254)}\nОт: ${safeText(message.from_address, 254)}\nТема: ${safeText(message.subject, 500)}\n\n${safeText(message.body_text, 100_000)}\n\n${process.env.CRM_PUBLIC_ORIGIN}/mail` };
}

async function deliverPending() {
  if (!smtpReady) return 0;
  const transport = nodemailer.createTransport({ host: process.env.CRM_MAIL_SMTP_HOST,
    port: Number(process.env.CRM_MAIL_SMTP_PORT || 465), secure: Number(process.env.CRM_MAIL_SMTP_PORT || 465) === 465,
    requireTLS: Number(process.env.CRM_MAIL_SMTP_PORT || 465) !== 465,
    tls: { servername: process.env.CRM_MAIL_TLS_SERVERNAME || process.env.CRM_MAIL_SMTP_HOST },
    auth: { user: process.env.CRM_MAIL_SMTP_USER, pass: process.env.CRM_MAIL_SMTP_PASSWORD },
    connectionTimeout: 10_000, socketTimeout: 20_000, disableFileAccess: true, disableUrlAccess: true });
  let sent = 0;
  for (let index = 0; index < 20; index += 1) {
    const job = await claimDelivery();
    if (!job) break;
    try {
      const content = await contentFor(job);
      if (content) {
        await transport.sendMail({ from: process.env.CRM_MAIL_FROM,
          messageId: `<crm-${job.id}@tehstroinvest.ru>`, ...content,
          html: renderCrmEmail({ eyebrow: "Уведомление", title: content.subject, body: content.text }) });
        sent += 1;
      }
      await sql`UPDATE mail_delivery_jobs SET status = 'sent', sent_at = now(), locked_at = NULL,
        verification_token = NULL, last_error_code = NULL, updated_at = now() WHERE id = ${job.id}`;
    } catch (error) {
      const terminal = Number(job.attempts) >= 8;
      const retrySeconds = Math.min(3600, 60 * 2 ** Math.max(0, Number(job.attempts) - 1));
      await sql`UPDATE mail_delivery_jobs SET status = ${terminal ? 'failed' : 'pending'},
        next_attempt_at = now() + ${retrySeconds} * interval '1 second', locked_at = NULL,
        last_error_code = ${safeCliErrorCode(error, 'MAIL_DELIVERY_FAILED')}, updated_at = now()
        WHERE id = ${job.id}`;
    }
  }
  transport.close();
  return sent;
}

async function deliverEmailChallenges() {
  if (!otpReady) return 0;
  const transport = nodemailer.createTransport({ host: process.env.CRM_MAIL_SMTP_HOST,
    port: Number(process.env.CRM_MAIL_SMTP_PORT || 465), secure: Number(process.env.CRM_MAIL_SMTP_PORT || 465) === 465,
    requireTLS: Number(process.env.CRM_MAIL_SMTP_PORT || 465) !== 465,
    tls: { servername: process.env.CRM_MAIL_TLS_SERVERNAME || process.env.CRM_MAIL_SMTP_HOST },
    auth: { user: process.env.CRM_MAIL_SMTP_USER, pass: process.env.CRM_MAIL_SMTP_PASSWORD },
    connectionTimeout: 10_000, socketTimeout: 20_000, disableFileAccess: true, disableUrlAccess: true });
  let sent = 0;
  try {
    for (let index = 0; index < 20; index += 1) {
      const challenge = await sql.begin(async (transaction) => {
        const [row] = await transaction`SELECT challenge.id, challenge.organization_id,
            challenge.member_id, challenge.purpose, member.email
          FROM auth_email_challenges challenge
          JOIN organization_members member ON member.organization_id = challenge.organization_id
            AND member.id = challenge.member_id
          WHERE challenge.expires_at > now() AND challenge.delivery_attempts < 3
            AND member.active AND member.email IS NOT NULL
            AND (challenge.status = 'pending' OR (challenge.status = 'sending'
              AND challenge.locked_at < now() - interval '1 minute'))
          ORDER BY challenge.created_at, challenge.id
          FOR UPDATE OF challenge SKIP LOCKED LIMIT 1`;
        if (!row) return null;
        await transaction`UPDATE auth_email_challenges SET status = 'sending', locked_at = now(),
          delivery_attempts = delivery_attempts + 1 WHERE id = ${row.id}`;
        return row;
      });
      if (!challenge) break;
      try {
        const code = String(randomInt(0, 10_000_000)).padStart(7, "0");
        const enrollment = challenge.purpose === "enroll";
        const subject = enrollment ? "Подключение защиты входа · CORE" : "Код входа · CORE";
        const body = enrollment
          ? "Введите код в настройках безопасности. Он действует 10 минут. Если вы не подключали защиту входа, проигнорируйте письмо."
          : "Введите код на странице входа. Он действует 10 минут. Если вы не пытались войти, никому не сообщайте код.";
        await transport.sendMail({ from: process.env.CRM_MAIL_FROM, to: String(challenge.email),
          messageId: `<crm-code-${challenge.id}@tehstroinvest.ru>`, subject,
          text: `${subject}: ${code}\n\n${body}`,
          html: renderCrmEmail({ eyebrow: "Безопасность аккаунта", title: subject, body, code }) });
        await sql`UPDATE auth_email_challenges SET status = 'sent', sent_at = now(), locked_at = NULL,
          code_hash = ${hashEmailOtpCode(otpSecret, challenge.id, code)}
          WHERE id = ${challenge.id} AND status = 'sending'`;
        sent += 1;
      } catch (error) {
        await sql`UPDATE auth_email_challenges SET status = CASE WHEN delivery_attempts >= 3
          THEN 'failed' ELSE 'pending' END, locked_at = NULL
          WHERE id = ${challenge.id} AND status = 'sending'`;
        console.error(JSON.stringify({ operation: "mail_worker.auth_code", errorCode: safeCliErrorCode(error, "OTP_SEND_FAILED") }));
      }
    }
  } finally { transport.close(); }
  return sent;
}

async function deliverOutbox() {
  if (!outboundEnabled) return 0;
  let sent = 0;
  for (let index = 0; index < 20; index += 1) {
    const job = await sql.begin(async (transaction) => {
      await transaction`UPDATE mail_outbox SET status = 'failed', locked_at = NULL,
        last_error_code = 'MAIL_DELIVERY_UNCONFIRMED', updated_at = now()
        WHERE status = 'sending' AND attempts >= 8 AND locked_at < now() - interval '5 minutes'`;
      const [candidate] = await transaction`SELECT id FROM mail_outbox
        WHERE (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'sending' AND locked_at < now() - interval '5 minutes')
        ORDER BY next_attempt_at, created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!candidate) return null;
      const [claimed] = await transaction`UPDATE mail_outbox SET status = 'sending', attempts = attempts + 1,
        locked_at = now(), updated_at = now() WHERE id = ${candidate.id}
        RETURNING id, organization_id, source_id, from_address, to_address, subject, body_text,
          reply_to_message_id, attempts, internet_message_id, in_reply_to, reference_ids`;
      return claimed;
    });
    if (!job) break;
    try {
      const [source] = await sql`SELECT id FROM mail_sources WHERE organization_id = ${job.organization_id}
        AND id = ${job.source_id} AND address = ${job.from_address} AND active`;
      if (!source) throw new Error('MAIL_SOURCE_NOT_REGISTERED');
      const account = mailboxes.find((item) => item.address === job.from_address);
      if (!account) throw new Error('MAIL_ACCOUNT_NOT_CONFIGURED');
      const useAccountSmtp = Boolean(account.smtpHost && account.smtpUser && account.smtpPassword);
      if (!useAccountSmtp && (!smtpReady || job.from_address !== process.env.CRM_MAIL_FROM?.trim().toLowerCase())) {
        throw new Error('MAIL_SENDER_NOT_CONFIGURED');
      }
      const host = useAccountSmtp ? account.smtpHost : process.env.CRM_MAIL_SMTP_HOST;
      const port = useAccountSmtp ? account.smtpPort : Number(process.env.CRM_MAIL_SMTP_PORT || 465);
      const transport = nodemailer.createTransport({ host, port, secure: port === 465,
        requireTLS: port !== 465,
        tls: { servername: useAccountSmtp ? account.tlsServername || host : process.env.CRM_MAIL_TLS_SERVERNAME || host },
        auth: { user: useAccountSmtp ? account.smtpUser : process.env.CRM_MAIL_SMTP_USER,
          pass: useAccountSmtp ? account.smtpPassword : process.env.CRM_MAIL_SMTP_PASSWORD },
        connectionTimeout: 10_000, socketTimeout: 20_000, disableFileAccess: true, disableUrlAccess: true });
      try {
        let headers = { inReplyTo: job.in_reply_to, references: job.reference_ids };
        if (job.reply_to_message_id && !headers.inReplyTo) {
          const [parent] = await sql`SELECT internet_message_id, reference_ids FROM mail_messages
            WHERE organization_id = ${job.organization_id} AND id = ${job.reply_to_message_id} AND source_id = ${job.source_id}`;
          if (parent) headers = replyHeaders(parent);
        }
        await transport.sendMail({ from: job.from_address, to: job.to_address,
          messageId: job.internet_message_id || `<crm-outbox-${job.id}@${String(job.from_address).split('@')[1]}>`,
          inReplyTo: headers.inReplyTo || undefined, references: headers.references,
          subject: job.subject, text: job.body_text });
      } finally { transport.close(); }
      await sql`UPDATE mail_outbox SET status = 'sent', sent_at = now(), locked_at = NULL,
        last_error_code = NULL, updated_at = now() WHERE id = ${job.id}`;
      sent += 1;
    } catch (error) {
      const terminal = Number(job.attempts) >= 8 || ['MAIL_SOURCE_NOT_REGISTERED', 'MAIL_ACCOUNT_NOT_CONFIGURED',
        'MAIL_SENDER_NOT_CONFIGURED'].includes(error?.message);
      const retrySeconds = Math.min(3600, 60 * 2 ** Math.max(0, Number(job.attempts) - 1));
      await sql`UPDATE mail_outbox SET status = ${terminal ? 'failed' : 'pending'},
        next_attempt_at = now() + ${retrySeconds} * interval '1 second', locked_at = NULL,
        last_error_code = ${safeCliErrorCode(error, 'MAIL_SEND_FAILED')}, updated_at = now()
        WHERE id = ${job.id}`;
    }
  }
  return sent;
}

let stopping = false;
process.once("SIGTERM", () => { stopping = true; });
process.once("SIGINT", () => { stopping = true; });
try {
  if (process.argv.includes("--healthcheck")) {
    const [row] = await sql`SELECT heartbeat_at > now() - interval '2 minutes'
      AND status = 'succeeded' AS healthy
      FROM background_job_status WHERE job_name = 'mail.inbox'`;
    if (row?.healthy !== true) process.exitCode = 1;
  } else {
    do {
      const cycle = { imported: 0, sent: 0, otpSent: 0, outboxSent: 0 };
      let cycleStatus = 'succeeded';
      for (const [phase, run] of [['headers', backfillThreadHeaders], ['imported', syncInbox],
        ['sent', deliverPending], ['otpSent', deliverEmailChallenges], ['outboxSent', deliverOutbox]]) {
        try {
          const count = await run();
          if (phase !== 'headers') cycle[phase] = count;
        } catch (error) {
          if (phase === 'imported' && Number.isSafeInteger(error?.imported)) cycle.imported = error.imported;
          cycleStatus = 'failed';
          console.error(JSON.stringify({ operation: `mail_worker.${phase}`, errorCode: safeCliErrorCode(error, "MAIL_WORKER_FAILED") }));
        }
      }
      await sql`INSERT INTO background_job_status (job_name, status, heartbeat_at, last_started_at, last_result)
        VALUES ('mail.inbox', ${cycleStatus}, now(), now(), ${sql.json({ ...cycle, imapReady, smtpReady, otpReady, outboundEnabled })})
        ON CONFLICT (job_name) DO UPDATE SET status = EXCLUDED.status, heartbeat_at = now(),
          last_started_at = now(), last_result = EXCLUDED.last_result, updated_at = now()`;
      if (process.argv.includes("--once")) break;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!stopping);
  }
} finally { await sql.end({ timeout: 5 }); }
