CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  requested_by uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('usability', 'data', 'access', 'technical')),
  subject text NOT NULL CHECK (length(btrim(subject)) BETWEEN 5 AND 200),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 20 AND 4000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  FOREIGN KEY (organization_id, requested_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL))
);

CREATE INDEX support_requests_member_recent_idx
  ON support_requests (organization_id, requested_by, created_at DESC);

CREATE INDEX support_requests_queue_idx
  ON support_requests (organization_id, status, created_at)
  WHERE status IN ('new', 'in_progress');
