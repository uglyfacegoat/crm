CREATE TABLE backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  archive_name text CHECK (
    archive_name IS NULL OR archive_name ~ '^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$'
  ),
  database_bytes bigint CHECK (database_bytes IS NULL OR database_bytes >= 0),
  documents_bytes bigint CHECK (documents_bytes IS NULL OR documents_bytes >= 0),
  database_sha256 char(64) CHECK (database_sha256 IS NULL OR database_sha256 ~ '^[a-f0-9]{64}$'),
  documents_sha256 char(64) CHECK (documents_sha256 IS NULL OR documents_sha256 ~ '^[a-f0-9]{64}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  restore_verified_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 120),
  CHECK ((status = 'running') = (completed_at IS NULL)),
  CHECK (restore_verified_at IS NULL OR status = 'succeeded'),
  CHECK (
    status <> 'succeeded' OR (
      archive_name IS NOT NULL
      AND database_bytes IS NOT NULL
      AND documents_bytes IS NOT NULL
      AND database_sha256 IS NOT NULL
      AND documents_sha256 IS NOT NULL
      AND failure_code IS NULL
    )
  ),
  CHECK (status <> 'failed' OR failure_code IS NOT NULL),
  UNIQUE (archive_name)
);

CREATE INDEX backup_runs_started_at_idx ON backup_runs (started_at DESC);
CREATE INDEX backup_runs_status_idx ON backup_runs (status, started_at DESC);
