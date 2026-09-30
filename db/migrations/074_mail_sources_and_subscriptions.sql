CREATE TABLE mail_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  website_id uuid,
  address text NOT NULL UNIQUE CHECK (address = lower(address) AND position('@' in address) > 1),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 200),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);
CREATE INDEX mail_sources_website_idx ON mail_sources (organization_id, website_id) WHERE active;

ALTER TABLE mail_messages ADD COLUMN recipient_address text;
ALTER TABLE mail_messages ADD COLUMN source_id uuid;
ALTER TABLE mail_messages ADD CONSTRAINT mail_messages_source_fk
  FOREIGN KEY (organization_id, source_id) REFERENCES mail_sources(organization_id, id) ON DELETE RESTRICT;
CREATE INDEX mail_messages_source_recent_idx ON mail_messages (organization_id, source_id, received_at DESC);

CREATE TABLE member_mail_source_subscriptions (
  organization_id uuid NOT NULL,
  destination_id uuid NOT NULL,
  source_id uuid NOT NULL,
  leads_enabled boolean NOT NULL DEFAULT false,
  mail_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, destination_id, source_id),
  FOREIGN KEY (organization_id, destination_id)
    REFERENCES member_mail_destinations(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, source_id)
    REFERENCES mail_sources(organization_id, id) ON DELETE CASCADE,
  CHECK (leads_enabled OR mail_enabled)
);
CREATE INDEX mail_subscriptions_source_idx ON member_mail_source_subscriptions (organization_id, source_id);

CREATE OR REPLACE FUNCTION queue_website_lead_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT DISTINCT NEW.organization_id, destination.id, 'lead', NEW.id
    FROM mail_sources source
    JOIN member_mail_source_subscriptions subscription
      ON subscription.organization_id = source.organization_id AND subscription.source_id = source.id
    JOIN member_mail_destinations destination
      ON destination.organization_id = subscription.organization_id AND destination.id = subscription.destination_id
    JOIN organization_members member
      ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE source.organization_id = NEW.organization_id AND source.website_id = NEW.website_id
      AND source.active AND subscription.leads_enabled AND destination.leads_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant'));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION queue_incoming_mail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO mail_delivery_jobs (organization_id, destination_id, source_type, source_id)
    SELECT NEW.organization_id, destination.id, 'mail', NEW.id
    FROM mail_sources source
    JOIN member_mail_source_subscriptions subscription
      ON subscription.organization_id = source.organization_id AND subscription.source_id = source.id
    JOIN member_mail_destinations destination
      ON destination.organization_id = subscription.organization_id AND destination.id = subscription.destination_id
    JOIN organization_members member
      ON member.organization_id = destination.organization_id AND member.id = destination.member_id
    WHERE source.organization_id = NEW.organization_id AND source.id = NEW.source_id AND source.active
      AND subscription.mail_enabled AND destination.mail_enabled
      AND destination.verified_at IS NOT NULL AND member.active
      AND coalesce((SELECT allowed FROM member_permission_overrides override
        WHERE override.organization_id = member.organization_id AND override.member_id = member.id
          AND override.permission = 'leads.read'),
        member.role IN ('admin', 'manager', 'dispatcher', 'accountant'));
  RETURN NEW;
END $$;
