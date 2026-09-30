CREATE TABLE object_service_profiles (
  organization_id uuid NOT NULL,
  object_id uuid NOT NULL,
  area_square_meters numeric(12,2) CHECK (area_square_meters > 0),
  visits_per_month smallint CHECK (visits_per_month BETWEEN 1 AND 31),
  service_schedule text CHECK (service_schedule IS NULL OR length(service_schedule) <= 500),
  contract_total_minor bigint CHECK (contract_total_minor IS NULL OR contract_total_minor >= 0),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, object_id),
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE object_service_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  object_id uuid NOT NULL,
  catalog_item_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  line_kind text NOT NULL DEFAULT 'contract' CHECK (line_kind IN ('contract', 'request')),
  billing_basis text NOT NULL CHECK (billing_basis IN ('area', 'quantity', 'fixed')),
  quantity numeric(12,2) CHECK (quantity > 0),
  unit_price_minor bigint CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
  position integer NOT NULL CHECK (position > 0),
  FOREIGN KEY (organization_id, object_id) REFERENCES object_service_profiles(organization_id, object_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, catalog_item_id) REFERENCES catalog_items(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, object_id, position)
);
CREATE INDEX object_service_rates_catalog_idx ON object_service_rates (organization_id, catalog_item_id)
  WHERE catalog_item_id IS NOT NULL;
