ALTER TABLE mail_messages
  ADD COLUMN internet_message_id text,
  ADD COLUMN in_reply_to text,
  ADD COLUMN reference_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN thread_id uuid,
  ADD COLUMN headers_imported boolean NOT NULL DEFAULT false;
UPDATE mail_messages SET thread_id = id;
ALTER TABLE mail_messages ALTER COLUMN thread_id SET NOT NULL,
  ALTER COLUMN thread_id SET DEFAULT gen_random_uuid();

ALTER TABLE mail_outbox
  ADD COLUMN internet_message_id text,
  ADD COLUMN in_reply_to text,
  ADD COLUMN reference_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN thread_id uuid,
  ADD COLUMN request_key uuid;
UPDATE mail_outbox outgoing SET
  internet_message_id = '<crm-outbox-' || outgoing.id || '@' || split_part(outgoing.from_address, '@', 2) || '>',
  thread_id = coalesce((SELECT incoming.thread_id FROM mail_messages incoming
    WHERE incoming.organization_id = outgoing.organization_id AND incoming.id = outgoing.reply_to_message_id), outgoing.id);
ALTER TABLE mail_outbox ALTER COLUMN thread_id SET NOT NULL,
  ALTER COLUMN thread_id SET DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX mail_outbox_request_idx ON mail_outbox (organization_id, sender_member_id, request_key)
  WHERE request_key IS NOT NULL;
CREATE INDEX mail_messages_thread_idx ON mail_messages (organization_id, mailbox_address, thread_id, received_at, id);
CREATE INDEX mail_outbox_thread_idx ON mail_outbox (organization_id, from_address, thread_id, created_at, id);
CREATE INDEX mail_messages_internet_id_idx ON mail_messages (organization_id, mailbox_address, internet_message_id)
  WHERE internet_message_id IS NOT NULL;
CREATE INDEX mail_outbox_internet_id_idx ON mail_outbox (organization_id, from_address, internet_message_id)
  WHERE internet_message_id IS NOT NULL;
CREATE INDEX mail_messages_reply_id_idx ON mail_messages (organization_id, mailbox_address, in_reply_to) WHERE in_reply_to IS NOT NULL;
CREATE INDEX mail_outbox_reply_id_idx ON mail_outbox (organization_id, from_address, in_reply_to) WHERE in_reply_to IS NOT NULL;
CREATE INDEX mail_messages_references_idx ON mail_messages USING gin (reference_ids);
CREATE INDEX mail_outbox_references_idx ON mail_outbox USING gin (reference_ids);
CREATE INDEX mail_messages_header_backfill_idx ON mail_messages (created_at, id) WHERE NOT headers_imported;
