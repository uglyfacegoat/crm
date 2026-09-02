CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE service_visit_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  object_id uuid NOT NULL,
  assigned_master_id uuid,
  frequency_unit text NOT NULL CHECK (frequency_unit IN ('week', 'month')),
  frequency_interval smallint NOT NULL CHECK (frequency_interval BETWEEN 1 AND 12),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  local_time time NOT NULL,
  duration_minutes smallint NOT NULL CHECK (duration_minutes BETWEEN 15 AND 1440),
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CHECK (ends_on <= starts_on + interval '1 year'),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_master_id) REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

ALTER TABLE service_visits
  ADD COLUMN series_id uuid,
  ADD COLUMN occurrence_number smallint,
  ADD CONSTRAINT service_visits_series_occurrence_pair
    CHECK ((series_id IS NULL AND occurrence_number IS NULL) OR (series_id IS NOT NULL AND occurrence_number IS NOT NULL)),
  ADD CONSTRAINT service_visits_series_fk
    FOREIGN KEY (organization_id, series_id) REFERENCES service_visit_series(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_visits_series_occurrence_unique UNIQUE (organization_id, series_id, occurrence_number),
  ADD CONSTRAINT service_visits_master_no_overlap
    EXCLUDE USING gist (
      organization_id WITH =,
      assigned_master_id WITH =,
      tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
    ) WHERE (assigned_master_id IS NOT NULL AND status <> 'cancelled');

CREATE INDEX service_visit_series_order_idx
  ON service_visit_series (organization_id, order_id, starts_on DESC);

