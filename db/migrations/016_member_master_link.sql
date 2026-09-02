ALTER TABLE organization_members
  ADD COLUMN master_id uuid,
  ADD CONSTRAINT organization_members_master_fk
    FOREIGN KEY (organization_id, master_id)
    REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT organization_members_master_role
    CHECK (master_id IS NULL OR role = 'master'),
  ADD CONSTRAINT organization_members_master_required
    CHECK (role <> 'master' OR master_id IS NOT NULL) NOT VALID;

CREATE UNIQUE INDEX organization_members_master_unique_idx
  ON organization_members (organization_id, master_id)
  WHERE master_id IS NOT NULL;

CREATE INDEX organization_members_master_lookup_idx
  ON organization_members (organization_id, master_id, active)
  WHERE role = 'master';
