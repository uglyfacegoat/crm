CREATE TABLE document_templates (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 240),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  template_kind text NOT NULL CHECK (template_kind IN ('closing_act')),
  current_version_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE document_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  template_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  original_filename text NOT NULL CHECK (length(btrim(original_filename)) BETWEEN 1 AND 255),
  storage_key text NOT NULL CHECK (length(storage_key) BETWEEN 20 AND 500),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  extension text NOT NULL CHECK (extension IN ('pdf', 'docx')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, template_id) REFERENCES document_templates(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, template_id, version_number),
  UNIQUE (organization_id, storage_key),
  UNIQUE (organization_id, template_id, id)
);

ALTER TABLE document_templates
  ADD CONSTRAINT document_templates_current_version_fk
    FOREIGN KEY (organization_id, id, current_version_id)
    REFERENCES document_template_versions(organization_id, template_id, id) ON DELETE RESTRICT;

CREATE INDEX document_templates_active_idx
  ON document_templates (organization_id, template_kind, updated_at DESC)
  WHERE active;
