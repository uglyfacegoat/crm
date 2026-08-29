CREATE TABLE documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  object_id uuid NOT NULL,
  order_id uuid NOT NULL,
  visit_id uuid,
  contract_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 240),
  category text NOT NULL CHECK (category IN ('contract', 'act', 'visit_card', 'invoice', 'receipt', 'photo', 'other')),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  current_version_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, visit_id) REFERENCES service_visits(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
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
  FOREIGN KEY (organization_id, document_id) REFERENCES documents(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, uploaded_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, document_id, version_number),
  UNIQUE (organization_id, storage_key),
  UNIQUE (organization_id, document_id, id)
);

ALTER TABLE documents
  ADD CONSTRAINT documents_current_version_fk
    FOREIGN KEY (organization_id, id, current_version_id)
    REFERENCES document_versions(organization_id, document_id, id) ON DELETE RESTRICT;

CREATE TABLE document_favorites (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, document_id) REFERENCES documents(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, document_id, member_id)
);

CREATE INDEX documents_client_idx ON documents (organization_id, client_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX documents_object_idx ON documents (organization_id, object_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX documents_order_idx ON documents (organization_id, order_id, created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX documents_visit_idx ON documents (organization_id, visit_id, created_at DESC) WHERE visit_id IS NOT NULL AND archived_at IS NULL;
CREATE INDEX documents_category_idx ON documents (organization_id, category, created_at DESC) WHERE archived_at IS NULL;
