CREATE TABLE organization_order_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  next_order_number bigint NOT NULL DEFAULT 1001 CHECK (next_order_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD COLUMN client_contact_id uuid,
  ADD COLUMN client_name_snapshot text,
  ADD COLUMN object_name_snapshot text,
  ADD COLUMN object_address_snapshot text,
  ADD COLUMN contact_name_snapshot text,
  ADD COLUMN contact_phone_snapshot text,
  ADD COLUMN master_name_snapshot text,
  ADD COLUMN master_phone_snapshot text,
  ADD COLUMN status_reason text,
  ADD COLUMN notes text,
  ADD COLUMN created_by uuid;

UPDATE orders
SET client_name_snapshot = clients.legal_name,
    object_name_snapshot = client_objects.name,
    object_address_snapshot = client_objects.address
FROM clients, client_objects
WHERE clients.organization_id = orders.organization_id
  AND clients.id = orders.client_id
  AND client_objects.organization_id = orders.organization_id
  AND client_objects.id = orders.object_id;

UPDATE orders
SET master_name_snapshot = masters.full_name,
    master_phone_snapshot = masters.phone
FROM masters
WHERE masters.organization_id = orders.organization_id
  AND masters.id = orders.assigned_master_id;

ALTER TABLE orders
  ALTER COLUMN client_name_snapshot SET NOT NULL,
  ALTER COLUMN object_name_snapshot SET NOT NULL,
  ALTER COLUMN object_address_snapshot SET NOT NULL,
  ADD CONSTRAINT orders_client_contact_fk
    FOREIGN KEY (organization_id, client_contact_id)
    REFERENCES client_contacts(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT orders_created_by_fk
    FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT orders_cancelled_reason_required
    CHECK (status <> 'cancelled' OR (status_reason IS NOT NULL AND length(btrim(status_reason)) >= 3)),
  ADD CONSTRAINT orders_master_payment_requires_master
    CHECK (master_payment_snapshot_minor IS NULL OR assigned_master_id IS NOT NULL);

ALTER TABLE order_services
  ADD COLUMN position smallint,
  ADD COLUMN note text;

WITH ranked_services AS (
  SELECT id,
    row_number() OVER (PARTITION BY organization_id, order_id ORDER BY created_at, id) AS position
  FROM order_services
)
UPDATE order_services
SET position = ranked_services.position
FROM ranked_services
WHERE ranked_services.id = order_services.id;

ALTER TABLE order_services
  ALTER COLUMN position SET NOT NULL,
  ALTER COLUMN position SET DEFAULT 1,
  ADD CONSTRAINT order_services_position_range CHECK (position BETWEEN 1 AND 100);

CREATE UNIQUE INDEX order_services_position_unique_idx
  ON order_services (organization_id, order_id, position);

CREATE INDEX orders_status_created_idx
  ON orders (organization_id, status, created_at DESC);

CREATE INDEX orders_client_created_idx
  ON orders (organization_id, client_id, created_at DESC);

CREATE INDEX orders_contact_idx
  ON orders (organization_id, client_contact_id)
  WHERE client_contact_id IS NOT NULL;
