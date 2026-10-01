ALTER TABLE service_visits
  ADD COLUMN service_lines_snapshot jsonb,
  ADD COLUMN master_payment_snapshot_minor bigint;
ALTER TABLE service_visits
  ADD CONSTRAINT service_visits_service_lines_snapshot_check CHECK (
    service_lines_snapshot IS NULL OR
    (jsonb_typeof(service_lines_snapshot) = 'array' AND jsonb_array_length(service_lines_snapshot) <= 120)
  ),
  ADD CONSTRAINT service_visits_master_payment_snapshot_check CHECK (
    master_payment_snapshot_minor IS NULL OR master_payment_snapshot_minor >= 0
  );
