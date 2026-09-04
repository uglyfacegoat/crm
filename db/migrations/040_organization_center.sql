ALTER TABLE organizations
  ADD COLUMN organization_kind text NOT NULL DEFAULT 'company'
    CHECK (organization_kind IN ('center', 'company')),
  ADD COLUMN parent_organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX organizations_parent_name_unique_idx
  ON organizations (COALESCE(parent_organization_id, id), lower(name));

CREATE TABLE organization_access_grants (
  principal_organization_id uuid NOT NULL,
  principal_member_id uuid NOT NULL,
  target_organization_id uuid NOT NULL,
  target_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_organization_id, principal_member_id, target_organization_id),
  UNIQUE (target_organization_id, target_member_id),
  FOREIGN KEY (principal_organization_id, principal_member_id)
    REFERENCES organization_members(organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (target_organization_id, target_member_id)
    REFERENCES organization_members(organization_id, id)
    ON DELETE CASCADE,
  CHECK (principal_organization_id <> target_organization_id)
);

ALTER TABLE auth_sessions
  ADD COLUMN active_organization_id uuid,
  ADD COLUMN active_member_id uuid,
  ADD CONSTRAINT auth_sessions_active_scope_check CHECK (
    (active_organization_id IS NULL AND active_member_id IS NULL)
    OR (active_organization_id IS NOT NULL AND active_member_id IS NOT NULL)
  ),
  ADD CONSTRAINT auth_sessions_active_member_fk
    FOREIGN KEY (active_organization_id, active_member_id)
    REFERENCES organization_members(organization_id, id)
    ON DELETE RESTRICT;

CREATE INDEX auth_sessions_active_scope_idx
  ON auth_sessions (active_organization_id, active_member_id)
  WHERE active_organization_id IS NOT NULL;

UPDATE organizations
SET name = 'Центр компаний', organization_kind = 'center', updated_at = now()
WHERE id = (SELECT id FROM organizations ORDER BY created_at, id LIMIT 1)
  AND (SELECT count(*) FROM organizations) = 1;

