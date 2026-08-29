CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 240),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_at timestamptz,
  assigned_member_id uuid,
  related_order_id uuid,
  related_visit_id uuid,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'visit_reminder')),
  reminder_kind text CHECK (reminder_kind IS NULL OR reminder_kind IN ('prepare_visit')),
  idempotency_key uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((source = 'manual' AND reminder_kind IS NULL) OR (source = 'visit_reminder' AND reminder_kind IS NOT NULL AND related_visit_id IS NOT NULL)),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, idempotency_key),
  FOREIGN KEY (organization_id, assigned_member_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, related_order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, related_visit_id) REFERENCES service_visits(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, completed_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, updated_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX tasks_visit_reminder_unique_idx
  ON tasks (organization_id, related_visit_id, reminder_kind)
  WHERE source = 'visit_reminder';

CREATE INDEX tasks_open_due_idx
  ON tasks (organization_id, due_at, created_at DESC)
  WHERE status = 'open';

CREATE INDEX tasks_assignee_open_idx
  ON tasks (organization_id, assigned_member_id, due_at)
  WHERE status = 'open';

INSERT INTO tasks (
  organization_id, title, description, due_at, assigned_member_id, related_order_id, related_visit_id,
  source, reminder_kind, created_by, updated_by
)
SELECT service_visits.organization_id,
  'Подготовить выезд ' || orders.order_number,
  'Автоматическое напоминание по дате выезда.',
  service_visits.scheduled_start_at - interval '1 day',
  service_visits.created_by,
  service_visits.order_id,
  service_visits.id,
  'visit_reminder',
  'prepare_visit',
  service_visits.created_by,
  service_visits.updated_by
FROM service_visits
JOIN orders
  ON orders.organization_id = service_visits.organization_id
 AND orders.id = service_visits.order_id
WHERE service_visits.status <> 'cancelled';
