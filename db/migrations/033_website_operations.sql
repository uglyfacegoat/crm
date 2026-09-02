ALTER TABLE websites
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE website_integrations
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN last_sync_attempt_at timestamptz,
  ADD COLUMN next_sync_at timestamptz,
  ADD CONSTRAINT website_integrations_organization_id_id_key UNIQUE (organization_id, id);

CREATE INDEX website_integrations_sync_idx
  ON website_integrations (organization_id, status, next_sync_at)
  WHERE status IN ('pending', 'connected', 'error');

CREATE TABLE website_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('yandex_metrica', 'ga4', 'google_search_console', 'yandex_webmaster')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  records_imported integer NOT NULL DEFAULT 0 CHECK (records_imported >= 0),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CHECK ((status IN ('succeeded', 'failed')) = (completed_at IS NOT NULL)),
  CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, integration_id) REFERENCES website_integrations(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE INDEX website_sync_runs_integration_idx
  ON website_sync_runs (organization_id, integration_id, created_at DESC);
