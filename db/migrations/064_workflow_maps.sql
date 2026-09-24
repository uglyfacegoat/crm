CREATE TABLE workflow_maps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  draft jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb
    CHECK (jsonb_typeof(draft) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX workflow_maps_active_idx
  ON workflow_maps (organization_id, updated_at DESC, id)
  WHERE archived_at IS NULL;
