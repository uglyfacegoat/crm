CREATE TABLE organization_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_unit_id uuid,
  unit_kind text NOT NULL CHECK (unit_kind IN ('city', 'area')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  address text CHECK (address IS NULL OR length(btrim(address)) BETWEEN 3 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, parent_unit_id)
    REFERENCES organization_units(organization_id, id) ON DELETE RESTRICT,
  CHECK (parent_unit_id IS NULL OR parent_unit_id <> id)
);

CREATE UNIQUE INDEX organization_units_sibling_name_unique_idx
  ON organization_units (organization_id, COALESCE(parent_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), unit_kind, lower(name));

CREATE INDEX organization_units_parent_idx
  ON organization_units (organization_id, parent_unit_id, unit_kind, lower(name));
