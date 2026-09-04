CREATE TABLE member_permission_overrides (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  permission text NOT NULL CHECK (length(permission) BETWEEN 3 AND 100),
  allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, member_id, permission),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id)
    ON DELETE CASCADE
);

