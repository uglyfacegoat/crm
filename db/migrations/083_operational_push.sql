ALTER TABLE chat_push_subscriptions
  ADD COLUMN chat_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN events_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN events_enabled_at timestamptz,
  ADD CONSTRAINT chat_push_events_enabled_at_check
    CHECK (events_enabled = (events_enabled_at IS NOT NULL));

CREATE INDEX chat_push_subscriptions_events_idx
  ON chat_push_subscriptions (organization_id, member_id, events_enabled_at)
  WHERE events_enabled;

CREATE TABLE notification_push_deliveries (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  endpoint text NOT NULL REFERENCES chat_push_subscriptions(endpoint) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  sent_at timestamptz,
  last_status_code integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, endpoint)
);

CREATE INDEX notification_push_deliveries_retry_idx
  ON notification_push_deliveries (retry_at)
  WHERE sent_at IS NULL;
