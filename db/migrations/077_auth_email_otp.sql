CREATE TABLE auth_email_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  member_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  code_hash char(64),
  remember_session boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'consumed')),
  delivery_attempts smallint NOT NULL DEFAULT 0 CHECK (delivery_attempts BETWEEN 0 AND 5),
  verification_attempts smallint NOT NULL DEFAULT 0 CHECK (verification_attempts BETWEEN 0 AND 5),
  locked_at timestamptz,
  sent_at timestamptz,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, member_id) REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  CHECK (status NOT IN ('sent', 'consumed') OR code_hash IS NOT NULL),
  CHECK (expires_at > created_at)
);

CREATE INDEX auth_email_challenges_member_idx ON auth_email_challenges
  (organization_id, member_id, created_at DESC);
CREATE INDEX auth_email_challenges_delivery_idx ON auth_email_challenges
  (created_at, id) WHERE status IN ('pending', 'sending');
