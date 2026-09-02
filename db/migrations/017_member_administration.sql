ALTER TABLE organization_members
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT organization_members_version_positive CHECK (version > 0);

CREATE INDEX organization_members_admin_list_idx
  ON organization_members (organization_id, active DESC, display_name);
