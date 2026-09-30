CREATE TABLE member_profile_avatars (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  image_data bytea NOT NULL CHECK (octet_length(image_data) BETWEEN 1 AND 262144),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, member_id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);
