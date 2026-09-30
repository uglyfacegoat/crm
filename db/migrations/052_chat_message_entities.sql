CREATE TABLE chat_message_entities (
  organization_id uuid NOT NULL,
  message_id uuid NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN (
    'order', 'client', 'object', 'visit', 'contract', 'document', 'task', 'master', 'website'
  )),
  entity_id uuid NOT NULL,
  snapshot_schema_version smallint NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, message_id)
    REFERENCES chat_messages(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, message_id)
);

CREATE INDEX chat_message_entities_reference_idx
  ON chat_message_entities (organization_id, entity_type, entity_id, created_at DESC);
