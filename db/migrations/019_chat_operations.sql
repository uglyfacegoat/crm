ALTER TABLE chat_messages
  ALTER COLUMN author_id DROP NOT NULL,
  ADD COLUMN message_kind text NOT NULL DEFAULT 'user'
    CHECK (message_kind IN ('user', 'system')),
  ADD COLUMN system_event_key text,
  ADD COLUMN system_payload jsonb,
  ADD CONSTRAINT chat_messages_author_kind_consistency CHECK (
    (message_kind = 'user' AND author_id IS NOT NULL AND system_event_key IS NULL)
    OR (message_kind = 'system' AND author_id IS NULL AND system_event_key IS NOT NULL)
  );

CREATE UNIQUE INDEX chat_messages_system_event_unique_idx
  ON chat_messages (organization_id, system_event_key)
  WHERE system_event_key IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE chat_message_attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  message_id uuid NOT NULL,
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 20 AND 500),
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )),
  extension text NOT NULL CHECK (extension IN ('pdf', 'jpg', 'png', 'webp', 'docx', 'xlsx')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, message_id) REFERENCES chat_messages(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, message_id),
  UNIQUE (organization_id, storage_key)
);

CREATE INDEX chat_message_attachments_message_idx
  ON chat_message_attachments (organization_id, message_id);
