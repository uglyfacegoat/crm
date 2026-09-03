ALTER TABLE masters
  ADD COLUMN operational_status text NOT NULL DEFAULT 'working',
  ADD COLUMN working_days smallint[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::smallint[],
  ADD COLUMN status_until date,
  ADD COLUMN status_note text;

UPDATE masters
SET operational_status = CASE WHEN active THEN 'working' ELSE 'terminated' END;

ALTER TABLE masters
  ADD CONSTRAINT masters_operational_status_known
    CHECK (operational_status IN ('working', 'vacation', 'unavailable', 'terminated')),
  ADD CONSTRAINT masters_working_days_valid
    CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  ADD CONSTRAINT masters_status_note_length
    CHECK (status_note IS NULL OR length(status_note) <= 1000),
  ADD CONSTRAINT masters_terminated_inactive
    CHECK (operational_status <> 'terminated' OR active = false);

CREATE INDEX masters_assignment_availability_idx
  ON masters (organization_id, full_name)
  WHERE active AND operational_status = 'working';
