CREATE TABLE file_write_quarantine (
  operation_id uuid NOT NULL,
  storage_key text NOT NULL,
  quarantine_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  state text NOT NULL CHECK (state IN ('prepared', 'complete')),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (operation_id, storage_key),
  CHECK ((state = 'prepared' AND completed_at IS NULL) OR (state = 'complete' AND completed_at IS NOT NULL))
);

CREATE FUNCTION protect_completed_file_write_quarantine() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'complete' THEN
    RAISE EXCEPTION 'Completed file write quarantine history is append-only.';
  END IF;
  IF NEW.operation_id <> OLD.operation_id OR NEW.storage_key <> OLD.storage_key
    OR NEW.quarantine_path <> OLD.quarantine_path OR NEW.size_bytes <> OLD.size_bytes
    OR NEW.sha256 <> OLD.sha256 OR NEW.case_id <> OLD.case_id
    OR NEW.actor <> OLD.actor OR NEW.database_role <> OLD.database_role
    OR NEW.prepared_at <> OLD.prepared_at OR NEW.state <> 'complete'
    OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Prepared file write quarantine can only be completed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_write_quarantine_protect
BEFORE UPDATE OR DELETE ON file_write_quarantine
FOR EACH ROW EXECUTE FUNCTION protect_completed_file_write_quarantine();
