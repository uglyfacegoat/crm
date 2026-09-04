ALTER TABLE organization_members
  ADD COLUMN deleted_at timestamptz;

ALTER TABLE organization_members
  ADD CONSTRAINT organization_members_deleted_inactive_check
  CHECK (deleted_at IS NULL OR active = false);

CREATE INDEX organization_members_active_directory_idx
  ON organization_members (organization_id, display_name)
  WHERE deleted_at IS NULL;

UPDATE organization_members
SET active = false,
    deleted_at = now(),
    updated_at = now(),
    version = version + 1
WHERE email = 'admin@example.local'
  AND display_name = 'Иван Петров'
  AND deleted_at IS NULL;
