CREATE TABLE chat_push_subscriptions (
  endpoint text PRIMARY KEY CHECK (length(endpoint) BETWEEN 20 AND 2048),
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 40 AND 256),
  auth_secret text NOT NULL CHECK (length(auth_secret) BETWEEN 10 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX chat_push_subscriptions_recipient_idx
  ON chat_push_subscriptions (organization_id, member_id);
