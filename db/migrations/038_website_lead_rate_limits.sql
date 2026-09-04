CREATE TABLE website_lead_rate_limits (
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 100000),
  PRIMARY KEY (organization_id, website_id),
  FOREIGN KEY (organization_id, website_id)
    REFERENCES websites(organization_id, id)
    ON DELETE CASCADE
);
