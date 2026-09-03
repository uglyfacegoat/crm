CREATE TABLE website_hosting_profiles (
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 2 AND 160),
  plan_name text NOT NULL CHECK (length(btrim(plan_name)) BETWEEN 2 AND 160),
  server_region text NOT NULL CHECK (length(btrim(server_region)) BETWEEN 2 AND 160),
  monthly_cost_minor bigint NOT NULL CHECK (monthly_cost_minor >= 0),
  renewal_on date NOT NULL,
  ssl_expires_on date NOT NULL,
  disk_capacity_mb integer NOT NULL CHECK (disk_capacity_mb BETWEEN 128 AND 100000000),
  memory_capacity_mb integer NOT NULL CHECK (memory_capacity_mb BETWEEN 64 AND 10000000),
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, website_id),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, updated_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE website_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  measured_at timestamptz NOT NULL DEFAULT now(),
  health_status text NOT NULL CHECK (health_status IN ('healthy', 'degraded', 'down')),
  uptime_percent numeric(5, 2) NOT NULL CHECK (uptime_percent BETWEEN 0 AND 100),
  response_time_ms integer NOT NULL CHECK (response_time_ms BETWEEN 0 AND 600000),
  cpu_load_percent numeric(5, 2) NOT NULL CHECK (cpu_load_percent BETWEEN 0 AND 100),
  memory_used_mb integer NOT NULL CHECK (memory_used_mb >= 0),
  disk_used_mb integer NOT NULL CHECK (disk_used_mb >= 0),
  source text NOT NULL CHECK (source IN ('manual', 'monitor')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX website_health_snapshots_recent_idx
  ON website_health_snapshots (organization_id, website_id, measured_at DESC);
