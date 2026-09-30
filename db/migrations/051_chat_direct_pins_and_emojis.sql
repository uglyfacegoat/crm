ALTER TABLE chat_channels
  DROP CONSTRAINT chat_channels_audience_kind_check,
  DROP CONSTRAINT chat_channels_audience_shape_check,
  ADD CONSTRAINT chat_channels_audience_kind_check
    CHECK (audience_kind IN ('office', 'master_direct', 'direct')),
  ADD CONSTRAINT chat_channels_audience_shape_check
    CHECK (
      (audience_kind IN ('office', 'direct') AND subject_member_id IS NULL)
      OR (audience_kind = 'master_direct' AND kind = 'group' AND subject_member_id IS NOT NULL)
    );

ALTER TABLE chat_channel_members
  ADD COLUMN pinned boolean NOT NULL DEFAULT false;

CREATE TABLE chat_direct_channels (
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  first_member_id uuid NOT NULL,
  second_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (first_member_id::text < second_member_id::text),
  FOREIGN KEY (organization_id, channel_id)
    REFERENCES chat_channels(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, first_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, second_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, channel_id),
  UNIQUE (organization_id, first_member_id, second_member_id)
);

ALTER TABLE chat_message_reactions
  DROP CONSTRAINT chat_message_reactions_emoji_check,
  ADD CONSTRAINT chat_message_reactions_emoji_check
    CHECK (length(emoji) BETWEEN 1 AND 32);
