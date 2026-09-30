ALTER TABLE tasks
  DROP CONSTRAINT tasks_source_check,
  DROP CONSTRAINT tasks_check1,
  ADD CONSTRAINT tasks_source_check CHECK (source IN ('manual', 'visit_reminder', 'workflow')),
  ADD CONSTRAINT tasks_source_context_check CHECK (
    (source = 'manual' AND reminder_kind IS NULL)
    OR (source = 'visit_reminder' AND reminder_kind IS NOT NULL AND related_visit_id IS NOT NULL)
    OR (source = 'workflow' AND reminder_kind IS NULL AND related_visit_id IS NULL AND related_order_id IS NOT NULL)
  );

CREATE TABLE workflow_automation_activations (
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  activation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL DEFAULT true,
  enabled_by uuid NOT NULL,
  enabled_at timestamptz NOT NULL DEFAULT now(),
  stopped_by uuid,
  stopped_at timestamptz,
  PRIMARY KEY (organization_id, map_id),
  FOREIGN KEY (organization_id, map_id, version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, enabled_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, stopped_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  CHECK ((enabled AND stopped_at IS NULL AND stopped_by IS NULL)
    OR (NOT enabled AND stopped_at IS NOT NULL AND stopped_by IS NOT NULL))
);

CREATE INDEX workflow_automation_activations_enabled_idx
  ON workflow_automation_activations (organization_id, map_id)
  WHERE enabled;

CREATE TABLE workflow_automation_trials (
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  member_id uuid NOT NULL,
  order_id uuid NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, map_id, version, member_id),
  FOREIGN KEY (organization_id, map_id, version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, order_id)
    REFERENCES orders(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE workflow_automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  event_type text NOT NULL CHECK (event_type = 'order_created'),
  order_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'stopped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (organization_id, map_id, activation_id, order_id),
  FOREIGN KEY (organization_id, map_id, version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, order_id)
    REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'running') = (lease_until IS NOT NULL)),
  CHECK ((status IN ('succeeded', 'failed', 'stopped')) = (completed_at IS NOT NULL))
);

CREATE INDEX workflow_automation_jobs_due_idx
  ON workflow_automation_jobs (next_attempt_at, created_at, id)
  WHERE status IN ('pending', 'running');
CREATE INDEX workflow_automation_jobs_map_idx
  ON workflow_automation_jobs (organization_id, map_id, created_at DESC, id DESC);
