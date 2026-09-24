CREATE TABLE file_write_s3_quarantine (
  operation_id uuid NOT NULL,
  storage_key text NOT NULL,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  state text NOT NULL CHECK (state IN ('prepared', 'complete')),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (operation_id, storage_key),
  CHECK ((state = 'prepared' AND completed_at IS NULL) OR (state = 'complete' AND completed_at IS NOT NULL))
);

CREATE FUNCTION protect_file_write_s3_quarantine() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'complete' THEN
    RAISE EXCEPTION 'Completed S3 quarantine history is append-only.';
  END IF;
  IF NEW.operation_id <> OLD.operation_id OR NEW.storage_key <> OLD.storage_key
    OR NEW.manifest_sha256 <> OLD.manifest_sha256 OR NEW.case_id <> OLD.case_id
    OR NEW.actor <> OLD.actor OR NEW.database_role <> OLD.database_role
    OR NEW.prepared_at <> OLD.prepared_at OR NEW.state <> 'complete'
    OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Prepared S3 quarantine can only be completed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_write_s3_quarantine_protect
BEFORE UPDATE OR DELETE ON file_write_s3_quarantine
FOR EACH ROW EXECUTE FUNCTION protect_file_write_s3_quarantine();
