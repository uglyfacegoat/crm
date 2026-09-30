CREATE TABLE personal_note_mutations (
  owner_organization_id uuid NOT NULL,
  owner_member_id uuid NOT NULL,
  request_key uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('note.save', 'note.transfer')),
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (owner_organization_id, owner_member_id, request_key),
  FOREIGN KEY (owner_organization_id, owner_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  CHECK ((result IS NULL AND completed_at IS NULL)
    OR (jsonb_typeof(result) = 'object' AND completed_at IS NOT NULL))
);

-- Keep receipts when a note/template is later deleted. A retry acknowledges the
-- original operation and must never resurrect a deleted private record.
