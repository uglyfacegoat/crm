UPDATE tasks
SET status = 'completed',
    completed_at = service_visits.updated_at,
    completed_by = service_visits.updated_by,
    updated_by = service_visits.updated_by,
    updated_at = now(),
    version = tasks.version + 1
FROM service_visits
WHERE tasks.organization_id = service_visits.organization_id
  AND tasks.related_visit_id = service_visits.id
  AND tasks.source = 'visit_reminder'
  AND tasks.status = 'open'
  AND service_visits.status = 'completed';
