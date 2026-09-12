CREATE TABLE document_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_folder_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, parent_folder_id)
    REFERENCES document_folders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  CHECK (parent_folder_id IS NULL OR parent_folder_id <> id)
);

CREATE UNIQUE INDEX document_folders_sibling_name_unique_idx
  ON document_folders (organization_id, COALESCE(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE INDEX document_folders_parent_idx
  ON document_folders (organization_id, parent_folder_id, lower(name));

ALTER TABLE documents
  ADD COLUMN folder_id uuid,
  ADD CONSTRAINT documents_folder_fk
    FOREIGN KEY (organization_id, folder_id)
    REFERENCES document_folders(organization_id, id) ON DELETE RESTRICT;

CREATE INDEX documents_folder_idx
  ON documents (organization_id, folder_id, updated_at DESC)
  WHERE archived_at IS NULL;
