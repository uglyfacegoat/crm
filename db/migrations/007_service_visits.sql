ALTER TABLE service_visits
  ADD COLUMN scheduled_end_at timestamptz,
  ADD COLUMN client_name_snapshot text,
  ADD COLUMN object_name_snapshot text,
  ADD COLUMN object_address_snapshot text,
  ADD COLUMN master_name_snapshot text,
  ADD COLUMN master_phone_snapshot text,
  ADD COLUMN notes text,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN created_by uuid,
  ADD COLUMN updated_by uuid;

UPDATE service_visits
SET scheduled_end_at = scheduled_start_at + interval '2 hours';

UPDATE service_visits
SET client_name_snapshot = clients.legal_name,
    object_name_snapshot = client_objects.name,
    object_address_snapshot = client_objects.address
FROM client_objects, clients
WHERE client_objects.organization_id = service_visits.organization_id
  AND client_objects.id = service_visits.object_id
  AND clients.organization_id = client_objects.organization_id
  AND clients.id = client_objects.client_id;

UPDATE service_visits
SET master_name_snapshot = masters.full_name,
    master_phone_snapshot = masters.phone
FROM masters
WHERE masters.organization_id = service_visits.organization_id
  AND masters.id = service_visits.assigned_master_id;

ALTER TABLE service_visits
  ALTER COLUMN scheduled_end_at SET NOT NULL,
  ALTER COLUMN client_name_snapshot SET NOT NULL,
  ALTER COLUMN object_name_snapshot SET NOT NULL,
  ALTER COLUMN object_address_snapshot SET NOT NULL,
  ADD CONSTRAINT service_visits_time_range CHECK (scheduled_end_at > scheduled_start_at),
  ADD CONSTRAINT service_visits_organization_id_unique UNIQUE (organization_id, id),
  ADD CONSTRAINT service_visits_cancelled_reason_required
    CHECK (status <> 'cancelled' OR (cancellation_reason IS NOT NULL AND length(btrim(cancellation_reason)) >= 3)),
  ADD CONSTRAINT service_visits_created_by_fk
    FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT service_visits_updated_by_fk
    FOREIGN KEY (organization_id, updated_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX service_visits_order_start_unique_idx
  ON service_visits (organization_id, order_id, scheduled_start_at)
  WHERE order_id IS NOT NULL;

CREATE INDEX service_visits_master_schedule_idx
  ON service_visits (organization_id, assigned_master_id, scheduled_start_at, scheduled_end_at)
  WHERE assigned_master_id IS NOT NULL AND status <> 'cancelled';

CREATE TABLE service_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'schedule_changed', 'status_changed', 'master_changed', 'notes_changed')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, visit_id) REFERENCES service_visits(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX service_visit_events_visit_idx
  ON service_visit_events (organization_id, visit_id, created_at DESC);
