ALTER TABLE developer_accounts
  ADD COLUMN account_role text NOT NULL DEFAULT 'developer'
    CHECK (account_role IN ('developer', 'owner'));
