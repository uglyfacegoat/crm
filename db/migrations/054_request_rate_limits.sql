CREATE TABLE request_rate_limits (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_id uuid,
  operation text NOT NULL CHECK (length(operation) BETWEEN 1 AND 64),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL CHECK (request_count > 0),
  CONSTRAINT request_rate_limits_bucket_unique
    UNIQUE NULLS NOT DISTINCT (organization_id, member_id, operation),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);

COMMENT ON COLUMN request_rate_limits.member_id IS
  'NULL is the organization budget; otherwise this is a member budget. Rows are reused across windows.';
