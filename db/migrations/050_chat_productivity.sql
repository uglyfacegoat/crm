ALTER TABLE chat_message_attachments
  DROP CONSTRAINT chat_message_attachments_mime_type_check,
  DROP CONSTRAINT chat_message_attachments_extension_check,
  ADD CONSTRAINT chat_message_attachments_mime_type_check CHECK (mime_type IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav'
  )),
  ADD CONSTRAINT chat_message_attachments_extension_check CHECK (
    extension IN ('pdf', 'jpg', 'png', 'webp', 'docx', 'xlsx', 'webm', 'm4a', 'mp3', 'wav')
  );

CREATE TABLE chat_message_reactions (
  organization_id uuid NOT NULL,
  message_id uuid NOT NULL,
  member_id uuid NOT NULL,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '👏', '🔥', '✅')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, message_id)
    REFERENCES chat_messages(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, message_id, member_id, emoji)
);

CREATE INDEX chat_message_reactions_message_idx
  ON chat_message_reactions (organization_id, message_id, created_at);

CREATE TABLE chat_channel_avatars (
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 20 AND 500),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 3145728),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, channel_id)
    REFERENCES chat_channels(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, uploaded_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, channel_id),
  UNIQUE (organization_id, storage_key)
);
