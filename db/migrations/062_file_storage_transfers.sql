CREATE TABLE file_storage_transfers (
  id uuid PRIMARY KEY,
  direction text NOT NULL CHECK (direction IN ('local_to_s3', 's3_to_local')),
  case_id text NOT NULL CHECK (length(case_id) BETWEEN 3 AND 80),
  actor text NOT NULL CHECK (length(actor) BETWEEN 3 AND 120),
  database_role text NOT NULL,
  reference_sha256 text NOT NULL CHECK (reference_sha256 ~ '^[a-f0-9]{64}$'),
  reference_counts jsonb NOT NULL,
  file_count integer NOT NULL CHECK (file_count >= 0),
  total_bytes bigint NOT NULL CHECK (total_bytes >= 0),
  state text NOT NULL CHECK (state IN ('prepared', 'complete')),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((state = 'prepared' AND completed_at IS NULL) OR (state = 'complete' AND completed_at IS NOT NULL))
);

CREATE TABLE file_storage_transfer_items (
  transfer_id uuid NOT NULL REFERENCES file_storage_transfers(id) ON DELETE RESTRICT,
  storage_key text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'complete')),
  completed_at timestamptz,
  PRIMARY KEY (transfer_id, storage_key),
  CHECK ((state = 'pending' AND completed_at IS NULL) OR (state = 'complete' AND completed_at IS NOT NULL))
);

CREATE FUNCTION protect_file_storage_transfers() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'complete' THEN
    RAISE EXCEPTION 'Completed file storage transfer history is append-only.';
  END IF;
  IF NEW.id <> OLD.id OR NEW.direction <> OLD.direction OR NEW.case_id <> OLD.case_id
    OR NEW.actor <> OLD.actor OR NEW.database_role <> OLD.database_role
    OR NEW.reference_sha256 <> OLD.reference_sha256
    OR NEW.reference_counts <> OLD.reference_counts OR NEW.file_count <> OLD.file_count
    OR NEW.total_bytes <> OLD.total_bytes OR NEW.prepared_at <> OLD.prepared_at
    OR NEW.state <> 'complete' OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Prepared file storage transfer can only be completed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_storage_transfers_protect
BEFORE UPDATE OR DELETE ON file_storage_transfers
FOR EACH ROW EXECUTE FUNCTION protect_file_storage_transfers();

CREATE FUNCTION protect_file_storage_transfer_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.state = 'complete' THEN
    RAISE EXCEPTION 'Completed file storage transfer items are append-only.';
  END IF;
  IF NEW.transfer_id <> OLD.transfer_id OR NEW.storage_key <> OLD.storage_key
    OR NEW.size_bytes <> OLD.size_bytes OR NEW.sha256 <> OLD.sha256
    OR NEW.state <> 'complete' OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Pending file storage transfer item can only be completed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_storage_transfer_items_protect
BEFORE UPDATE OR DELETE ON file_storage_transfer_items
FOR EACH ROW EXECUTE FUNCTION protect_file_storage_transfer_items();
