ALTER TABLE tasks
  ADD COLUMN cancellation_reason text,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid,
  ADD CONSTRAINT tasks_cancellation_reason_length_check
    CHECK (cancellation_reason IS NULL OR length(btrim(cancellation_reason)) BETWEEN 3 AND 1000),
  ADD CONSTRAINT tasks_cancelled_at_status_check
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  ADD CONSTRAINT tasks_cancellation_reason_status_check
    CHECK ((status = 'cancelled') = (cancellation_reason IS NOT NULL)),
  ADD CONSTRAINT tasks_cancelled_by_status_check
    CHECK ((status = 'cancelled') = (cancelled_by IS NOT NULL)),
  ADD CONSTRAINT tasks_cancelled_by_fkey
    FOREIGN KEY (organization_id, cancelled_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT;

CREATE TABLE task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'rescheduled', 'reassigned', 'completed', 'cancelled')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX task_events_task_idx
  ON task_events (organization_id, task_id, created_at DESC, id DESC);

INSERT INTO task_events (organization_id, task_id, actor_id, event_type, after_state, created_at)
SELECT organization_id, id, coalesce(created_by, updated_by), 'created',
  jsonb_build_object(
    'title', title,
    'description', description,
    'priority', priority,
    'dueAt', due_at,
    'assignedMemberId', assigned_member_id,
    'status', status,
    'source', source,
    'version', 1
  ),
  created_at
FROM tasks;

CREATE FUNCTION record_visit_reminder_task_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.source <> 'visit_reminder'
    OR (OLD.due_at IS NOT DISTINCT FROM NEW.due_at AND OLD.status = NEW.status)
  THEN
    RETURN NEW;
  END IF;

  INSERT INTO task_events (
    organization_id, task_id, actor_id, event_type, before_state, after_state, reason
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    NEW.updated_by,
    CASE
      WHEN OLD.status <> NEW.status AND NEW.status = 'completed' THEN 'completed'
      WHEN OLD.status <> NEW.status AND NEW.status = 'cancelled' THEN 'cancelled'
      WHEN OLD.due_at IS DISTINCT FROM NEW.due_at THEN 'rescheduled'
      ELSE 'updated'
    END,
    jsonb_build_object(
      'title', OLD.title,
      'description', OLD.description,
      'priority', OLD.priority,
      'dueAt', OLD.due_at,
      'assignedMemberId', OLD.assigned_member_id,
      'status', OLD.status,
      'source', OLD.source,
      'version', OLD.version
    ),
    jsonb_build_object(
      'title', NEW.title,
      'description', NEW.description,
      'priority', NEW.priority,
      'dueAt', NEW.due_at,
      'assignedMemberId', NEW.assigned_member_id,
      'status', NEW.status,
      'source', NEW.source,
      'version', NEW.version
    ),
    NEW.cancellation_reason
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_visit_reminder_history_trigger
AFTER UPDATE OF due_at, status ON tasks
FOR EACH ROW
EXECUTE FUNCTION record_visit_reminder_task_event();
