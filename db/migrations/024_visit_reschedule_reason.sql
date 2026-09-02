ALTER TABLE service_visit_events
  ADD CONSTRAINT service_visit_events_schedule_reason_required
  CHECK (
    event_type <> 'schedule_changed'
    OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 3 AND 1000)
  ) NOT VALID;
