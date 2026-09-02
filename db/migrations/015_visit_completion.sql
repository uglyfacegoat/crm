ALTER TABLE documents
  ADD CONSTRAINT documents_organization_id_id_visit_id_unique
  UNIQUE (organization_id, id, visit_id);

ALTER TABLE service_visits
  ADD COLUMN completion_notes text,
  ADD COLUMN completion_document_id uuid,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN completed_by uuid,
  ADD CONSTRAINT service_visits_completion_notes_length
    CHECK (completion_notes IS NULL OR length(btrim(completion_notes)) BETWEEN 3 AND 4000),
  ADD CONSTRAINT service_visits_completion_document_fk
    FOREIGN KEY (organization_id, completion_document_id, id)
    REFERENCES documents(organization_id, id, visit_id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_visits_completed_by_fk
    FOREIGN KEY (organization_id, completed_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_visits_completion_required
    CHECK (
      status <> 'completed'
      OR (
        completion_document_id IS NOT NULL
        AND completion_notes IS NOT NULL
        AND completed_at IS NOT NULL
        AND completed_by IS NOT NULL
      )
    ) NOT VALID;

CREATE INDEX service_visits_completion_document_idx
  ON service_visits (organization_id, completion_document_id)
  WHERE completion_document_id IS NOT NULL;
