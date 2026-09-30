CREATE TABLE file_write_s3_restore_drills (
  operation_id uuid NOT NULL,
  storage_key text NOT NULL,
  target_id text NOT NULL CHECK (target_id ~ '^[a-f0-9]{64}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  report_sha256 text NOT NULL CHECK (report_sha256 ~ '^[a-f0-9]{64}$'),
  report jsonb NOT NULL,
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operation_id, storage_key, target_id)
);

CREATE FUNCTION protect_file_write_s3_restore_drills() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'S3 restore drill history is append-only.';
END;
$$;

CREATE TRIGGER file_write_s3_restore_drills_protect
BEFORE UPDATE OR DELETE ON file_write_s3_restore_drills
FOR EACH ROW EXECUTE FUNCTION protect_file_write_s3_restore_drills();
