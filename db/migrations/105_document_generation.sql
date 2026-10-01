ALTER TABLE document_template_versions
  ADD COLUMN generation_kind text CHECK (generation_kind IN ('pdf_form', 'docx_placeholders')),
  ADD COLUMN generation_fields text[] NOT NULL DEFAULT '{}',
  ADD COLUMN generation_defaults jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(generation_defaults) = 'object');
ALTER TABLE documents
  ADD COLUMN generated_template_version_id uuid,
  ADD COLUMN generation_input_hash char(64) CHECK (generation_input_hash IS NULL OR generation_input_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT documents_generated_template_version_fk FOREIGN KEY (organization_id, generated_template_version_id)
    REFERENCES document_template_versions(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT documents_generation_metadata_check CHECK ((generated_template_version_id IS NULL) = (generation_input_hash IS NULL));
