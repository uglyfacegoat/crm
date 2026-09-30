CREATE TABLE developer_accounts (
  email text PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(btrim(email))),
  CHECK (length(email) BETWEEN 3 AND 254)
);

INSERT INTO developer_accounts (email, display_name)
VALUES ('yaroslav.crm@local.test', 'Ярослав')
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name;

ALTER TABLE support_requests
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN handled_by_email text REFERENCES developer_accounts(email) ON DELETE RESTRICT;

CREATE INDEX support_requests_developer_queue_idx
  ON support_requests (status, updated_at DESC, created_at DESC);
