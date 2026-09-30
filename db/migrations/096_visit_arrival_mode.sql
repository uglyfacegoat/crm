ALTER TABLE service_visits
  ADD COLUMN arrival_mode text NOT NULL DEFAULT 'window'
    CHECK (arrival_mode IN ('fixed', 'window'));
