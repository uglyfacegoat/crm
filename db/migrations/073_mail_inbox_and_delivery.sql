CREATE TABLE mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  mailbox_address text NOT NULL,
  uid_validity bigint NOT NULL CHECK (uid_validity > 0),
  imap_uid bigint NOT NULL CHECK (imap_uid > 0),
  from_address text NOT NULL,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  raw_message bytea NOT NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, mailbox_address, uid_validity, imap_uid),
  UNIQUE (organization_id, id),
  CHECK (octet_length(raw_message) <= 5242880)
);
CREATE INDEX mail_messages_recent_idx ON mail_messages (organization_id, received_at DESC, id DESC);

CREATE TABLE mail_sync_state (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  mailbox_address text NOT NULL,
  uid_validity bigint NOT NULL CHECK (uid_validity > 0),
  last_uid bigint NOT NULL DEFAULT 0 CHECK (last_uid >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, mailbox_address)
);

CREATE TABLE member_mail_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  email text NOT NULL CHECK (email = lower(email)),
  leads_enabled boolean NOT NULL DEFAULT true,
  mail_enabled boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  verification_hash text,
  verification_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, member_id, email),
  UNIQUE (organization_id, id),
  CHECK ((verification_hash IS NULL) = (verification_expires_at IS NULL))
);

CREATE TABLE mail_delivery_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('verify', 'lead', 'mail')),
  source_id uuid NOT NULL,
  verification_token text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, destination_id) REFERENCES member_mail_destinations(organization_id, id) ON DELETE CASCADE,
  UNIQUE (destination_id, source_type, source_id),
  CHECK ((source_type <> 'verify' AND verification_token IS NULL)
    OR (source_type = 'verify' AND (verification_token IS NOT NULL OR status = 'sent')))
);
CREATE INDEX mail_delivery_due_idx ON mail_delivery_jobs (next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'sending');

CREATE FUNCTION queue_website_lead_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT NEW.organization_id, destination.id, 'lead', NEW.id
    FROM member_mail_destinations destination
    JOIN organization_members member ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE destination.organization_id = NEW.organization_id AND destination.leads_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant'));
  RETURN NEW;
END $$;
CREATE TRIGGER website_lead_mail_enqueue AFTER INSERT ON website_leads
  FOR EACH ROW EXECUTE FUNCTION queue_website_lead_mail();

CREATE FUNCTION queue_incoming_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT NEW.organization_id, destination.id, 'mail', NEW.id
    FROM member_mail_destinations destination
    JOIN organization_members member ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE destination.organization_id = NEW.organization_id AND destination.mail_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant'));
  RETURN NEW;
END $$;
CREATE TRIGGER incoming_mail_enqueue AFTER INSERT ON mail_messages
  FOR EACH ROW EXECUTE FUNCTION queue_incoming_mail();
