CREATE TABLE import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_format text NOT NULL CHECK (source_format = 'crm_csv_v1'),
  package_fingerprint char(64) NOT NULL CHECK (package_fingerprint ~ '^[a-f0-9]{64}$'),
  source_files jsonb NOT NULL CHECK (jsonb_typeof(source_files) = 'object'),
  status text NOT NULL CHECK (status IN ('ready', 'blocked', 'applied')),
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  error_count integer NOT NULL CHECK (error_count >= 0),
  warning_count integer NOT NULL CHECK (warning_count >= 0),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  applied_at timestamptz,
  CHECK ((status = 'blocked') = (error_count > 0)),
  CHECK ((status = 'applied') = (applied_at IS NOT NULL)),
  CHECK ((status = 'applied') = (applied_by IS NOT NULL)),
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, applied_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, package_fingerprint),
  UNIQUE (organization_id, id)
);

CREATE INDEX import_jobs_created_idx ON import_jobs (organization_id, created_at DESC);

CREATE TABLE import_job_issues (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  import_job_id uuid NOT NULL,
  dataset text NOT NULL CHECK (dataset IN ('package', 'clients', 'objects', 'orders', 'services', 'documents')),
  row_number integer NOT NULL CHECK (row_number >= 1),
  severity text NOT NULL CHECK (severity IN ('error', 'warning')),
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,79}$'),
  field text CHECK (field IS NULL OR field ~ '^[a-z][a-z0-9_]{0,79}$'),
  message text NOT NULL CHECK (length(message) BETWEEN 3 AND 500),
  FOREIGN KEY (organization_id, import_job_id) REFERENCES import_jobs(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX import_job_issues_job_idx
  ON import_job_issues (organization_id, import_job_id, severity, dataset, row_number);

CREATE TABLE import_record_links (
  organization_id uuid NOT NULL,
  source_format text NOT NULL CHECK (source_format = 'crm_csv_v1'),
  record_type text NOT NULL CHECK (record_type IN ('client', 'object', 'order', 'service', 'document')),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 120),
  entity_id uuid NOT NULL,
  import_job_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, import_job_id) REFERENCES import_jobs(organization_id, id) ON DELETE RESTRICT,
  PRIMARY KEY (organization_id, source_format, record_type, external_id)
);

CREATE INDEX import_record_links_entity_idx
  ON import_record_links (organization_id, record_type, entity_id);
