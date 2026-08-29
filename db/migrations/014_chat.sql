CREATE TABLE chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  kind text NOT NULL CHECK (kind IN ('general', 'group')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX chat_channels_active_name_unique_idx
  ON chat_channels (organization_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX chat_channels_general_unique_idx
  ON chat_channels (organization_id)
  WHERE kind = 'general' AND archived_at IS NULL;

CREATE TABLE chat_channel_members (
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  member_id uuid NOT NULL,
  channel_role text NOT NULL CHECK (channel_role IN ('owner', 'member')),
  joined_by uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  muted boolean NOT NULL DEFAULT false,
  FOREIGN KEY (organization_id, channel_id) REFERENCES chat_channels(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, joined_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, channel_id, member_id)
);

CREATE INDEX chat_channel_members_member_idx
  ON chat_channel_members (organization_id, member_id, joined_at DESC);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  reply_to_message_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  FOREIGN KEY (organization_id, channel_id) REFERENCES chat_channels(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, author_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reply_to_message_id) REFERENCES chat_messages(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX chat_messages_channel_created_idx
  ON chat_messages (organization_id, channel_id, created_at DESC)
  WHERE deleted_at IS NULL;
