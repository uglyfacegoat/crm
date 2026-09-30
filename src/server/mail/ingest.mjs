import { randomUUID } from 'node:crypto';
import { threadHeaders } from './thread-headers.mjs';

// Match protocol references within one organization and mailbox, never by subject.
// Merge provisional threads when a parent arrives after its reply.
export async function saveIncomingMail(sql, message, parsed, advanceSync = true) {
  const headers = threadHeaders(parsed);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${message.organizationId}), hashtext(${message.mailbox}))`;
    const relatedIds = [...new Set([...headers.references, headers.inReplyTo, headers.messageId].filter(Boolean))];
    const matches = relatedIds.length ? await tx`
      SELECT thread_id FROM mail_messages
      WHERE organization_id = ${message.organizationId} AND mailbox_address = ${message.mailbox}
        AND (internet_message_id = ANY(${relatedIds}::text[]) OR
          (${headers.messageId}::text IS NOT NULL AND (${headers.messageId} = in_reply_to OR reference_ids @> ARRAY[${headers.messageId}]::text[])))
      UNION
      SELECT thread_id FROM mail_outbox
      WHERE organization_id = ${message.organizationId} AND from_address = ${message.mailbox}
        AND (internet_message_id = ANY(${relatedIds}::text[]) OR
          (${headers.messageId}::text IS NOT NULL AND (${headers.messageId} = in_reply_to OR reference_ids @> ARRAY[${headers.messageId}]::text[])))
      ORDER BY thread_id` : [];
    const [existing] = await tx`SELECT thread_id FROM mail_messages WHERE organization_id = ${message.organizationId}
      AND mailbox_address = ${message.mailbox} AND uid_validity = ${message.validity} AND imap_uid = ${message.uid}`;
    const threads = [...new Set([...matches.map(row => row.thread_id), existing?.thread_id].filter(Boolean))];
    const threadId = threads[0] ?? randomUUID();
    if (threads.length) {
      await tx`UPDATE mail_messages SET thread_id = ${threadId} WHERE organization_id = ${message.organizationId}
        AND mailbox_address = ${message.mailbox} AND thread_id = ANY(${threads}::uuid[]) AND thread_id <> ${threadId}`;
      await tx`UPDATE mail_outbox SET thread_id = ${threadId} WHERE organization_id = ${message.organizationId}
        AND from_address = ${message.mailbox} AND thread_id = ANY(${threads}::uuid[]) AND thread_id <> ${threadId}`;
    }
    const [row] = await tx`INSERT INTO mail_messages
      (organization_id, mailbox_address, uid_validity, imap_uid, from_address, from_name, to_addresses,
        subject, body_text, raw_message, received_at, recipient_address, source_id,
        internet_message_id, in_reply_to, reference_ids, thread_id, headers_imported)
      VALUES (${message.organizationId}, ${message.mailbox}, ${message.validity}, ${message.uid},
        ${message.fromAddress}, ${message.fromName}, ${message.toAddresses}, ${message.subject}, ${message.bodyText},
        ${message.raw}, ${message.receivedAt}, ${message.recipientAddress}, ${message.sourceId},
        ${headers.messageId}, ${headers.inReplyTo}, ${headers.references}, ${threadId}, true)
      ON CONFLICT (organization_id, mailbox_address, uid_validity, imap_uid) DO UPDATE SET
        internet_message_id = EXCLUDED.internet_message_id, in_reply_to = EXCLUDED.in_reply_to,
        reference_ids = EXCLUDED.reference_ids, thread_id = EXCLUDED.thread_id, headers_imported = true
      RETURNING id, thread_id`;
    if (advanceSync) await tx`INSERT INTO mail_sync_state (organization_id, mailbox_address, uid_validity, last_uid)
      VALUES (${message.organizationId}, ${message.mailbox}, ${message.validity}, ${message.uid})
      ON CONFLICT (organization_id, mailbox_address) DO UPDATE SET uid_validity = EXCLUDED.uid_validity,
        last_uid = EXCLUDED.last_uid, updated_at = now()`;
    return row;
  });
}
