ALTER TABLE document_versions
  ADD COLUMN change_note text
    CHECK (change_note IS NULL OR length(btrim(change_note)) BETWEEN 2 AND 1000);

CREATE INDEX document_versions_history_idx
  ON document_versions (organization_id, document_id, version_number DESC);
