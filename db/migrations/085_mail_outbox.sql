CREATE TABLE mail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  source_id uuid NOT NULL,
  sender_member_id uuid NOT NULL,
  from_address text NOT NULL,
  to_address text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  reply_to_message_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, source_id) REFERENCES mail_sources(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, sender_member_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, reply_to_message_id) REFERENCES mail_messages(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  CHECK (length(subject) <= 500),
  CHECK (length(body_text) <= 100000)
);
CREATE INDEX mail_outbox_recent_idx ON mail_outbox (organization_id, created_at DESC, id DESC);
CREATE INDEX mail_outbox_due_idx ON mail_outbox (next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'sending');
