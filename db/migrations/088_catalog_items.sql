CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('service', 'product')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  sku text CHECK (sku IS NULL OR length(sku) <= 80),
  unit text NOT NULL CHECK (length(btrim(unit)) BETWEEN 1 AND 40),
  price_mode text NOT NULL CHECK (price_mode IN ('fixed', 'variable')),
  default_price_minor bigint CHECK (default_price_minor IS NULL OR default_price_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  CHECK (price_mode = 'variable' OR default_price_minor IS NOT NULL)
);

CREATE UNIQUE INDEX catalog_items_name_unique ON catalog_items (organization_id, kind, lower(name));
CREATE UNIQUE INDEX catalog_items_sku_unique ON catalog_items (organization_id, lower(sku)) WHERE sku IS NOT NULL;
CREATE INDEX catalog_items_browse_idx ON catalog_items (organization_id, active, kind, name);

ALTER TABLE order_services ADD COLUMN catalog_item_id uuid;
ALTER TABLE order_services ADD COLUMN item_kind_snapshot text NOT NULL DEFAULT 'service' CHECK (item_kind_snapshot IN ('service', 'product'));
ALTER TABLE order_services ADD COLUMN unit_snapshot text NOT NULL DEFAULT 'усл.' CHECK (length(btrim(unit_snapshot)) BETWEEN 1 AND 40);
ALTER TABLE order_services ADD CONSTRAINT order_services_catalog_item_fk
  FOREIGN KEY (organization_id, catalog_item_id) REFERENCES catalog_items(organization_id, id) ON DELETE RESTRICT;
CREATE INDEX order_services_catalog_item_idx ON order_services (organization_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
