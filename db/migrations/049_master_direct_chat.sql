ALTER TABLE chat_channels
  ADD COLUMN audience_kind text NOT NULL DEFAULT 'office',
  ADD COLUMN subject_member_id uuid,
  ADD CONSTRAINT chat_channels_audience_kind_check
    CHECK (audience_kind IN ('office', 'master_direct')),
  ADD CONSTRAINT chat_channels_audience_shape_check
    CHECK (
      (audience_kind = 'office' AND subject_member_id IS NULL)
      OR (audience_kind = 'master_direct' AND kind = 'group' AND subject_member_id IS NOT NULL)
    ),
  ADD CONSTRAINT chat_channels_subject_member_fk
    FOREIGN KEY (organization_id, subject_member_id)
    REFERENCES organization_members(organization_id, id)
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX chat_channels_active_master_direct_unique_idx
  ON chat_channels (organization_id, subject_member_id)
  WHERE audience_kind = 'master_direct' AND archived_at IS NULL;
