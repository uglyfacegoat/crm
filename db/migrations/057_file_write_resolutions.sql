CREATE TABLE file_write_resolutions (
  operation_id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  storage_keys text[] NOT NULL,
  review jsonb NOT NULL,
  review_sha256 text NOT NULL CHECK (review_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION reject_file_write_resolution_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'File write resolution history is append-only.';
END;
$$;

CREATE TRIGGER file_write_resolutions_immutable
BEFORE UPDATE OR DELETE ON file_write_resolutions
FOR EACH ROW EXECUTE FUNCTION reject_file_write_resolution_change();
