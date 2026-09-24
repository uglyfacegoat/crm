CREATE TABLE workflow_map_watchers (
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, map_id, member_id),
  FOREIGN KEY (organization_id, map_id)
    REFERENCES workflow_maps(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX workflow_map_watchers_member_idx
  ON workflow_map_watchers (organization_id, member_id, map_id);

-- Existing map creators receive changes to maps they already own.
INSERT INTO workflow_map_watchers (organization_id, map_id, member_id)
SELECT organization_id, id, created_by FROM workflow_maps WHERE archived_at IS NULL;

ALTER TABLE notifications
  DROP CONSTRAINT notifications_kind_check,
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'visit_upcoming', 'visit_unassigned', 'closing_act_overdue', 'task_overdue',
    'contract_renewal', 'document_uploaded', 'workflow_update'
  )),
  DROP CONSTRAINT notifications_source_type_check,
  ADD CONSTRAINT notifications_source_type_check CHECK (source_type IN (
    'visit', 'task', 'contract', 'document', 'workflow'
  )),
  DROP CONSTRAINT notifications_target_type_check,
  ADD CONSTRAINT notifications_target_type_check CHECK (target_type IN (
    'order', 'visit', 'task', 'client', 'document', 'workflow'
  ));
