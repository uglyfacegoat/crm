ALTER TABLE notifications
  DROP CONSTRAINT notifications_kind_check,
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'visit_upcoming', 'visit_unassigned', 'closing_act_overdue', 'task_overdue',
    'task_assigned', 'contract_renewal', 'document_uploaded', 'workflow_update'
  ));
