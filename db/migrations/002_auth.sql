CREATE TABLE member_login_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('email', 'phone')),
  normalized_value text NOT NULL CHECK (normalized_value = lower(btrim(normalized_value))),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  UNIQUE (kind, normalized_value),
  UNIQUE (organization_id, member_id, kind)
);

CREATE TABLE member_credentials (
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  password_hash text NOT NULL,
  failed_login_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_login_attempts BETWEEN 0 AND 100),
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, member_id),
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  client_fingerprint_hash char(64),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX auth_sessions_member_idx ON auth_sessions (organization_id, member_id, created_at DESC);
CREATE INDEX auth_sessions_active_idx ON auth_sessions (token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE auth_rate_limits (
  bucket_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_rate_limits_cleanup_idx ON auth_rate_limits (window_started_at);

ALTER TABLE audit_events
  ADD COLUMN auth_session_id uuid REFERENCES auth_sessions(id) ON DELETE SET NULL;

CREATE INDEX audit_events_session_idx ON audit_events (auth_session_id, created_at DESC) WHERE auth_session_id IS NOT NULL;
