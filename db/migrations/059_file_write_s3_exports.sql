CREATE TABLE file_write_s3_exports (
  operation_id uuid NOT NULL,
  storage_key text NOT NULL,
  export_path text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, storage_key)
);

CREATE FUNCTION protect_file_write_s3_exports() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Completed S3 version exports are append-only.';
END;
$$;

CREATE TRIGGER file_write_s3_exports_protect
BEFORE UPDATE OR DELETE ON file_write_s3_exports
FOR EACH ROW EXECUTE FUNCTION protect_file_write_s3_exports();
