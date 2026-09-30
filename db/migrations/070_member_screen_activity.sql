CREATE TABLE member_screen_activity (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  bucket_start timestamptz NOT NULL,
  screen_key text NOT NULL CHECK (length(screen_key) BETWEEN 1 AND 40),
  seconds smallint NOT NULL DEFAULT 30 CHECK (seconds BETWEEN 1 AND 30),
  PRIMARY KEY (organization_id, member_id, bucket_start),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX member_screen_activity_recent_idx
  ON member_screen_activity (organization_id, bucket_start DESC);
