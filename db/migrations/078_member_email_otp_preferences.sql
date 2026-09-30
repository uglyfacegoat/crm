ALTER TABLE member_credentials
  ADD COLUMN email_otp_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE auth_email_challenges
  ADD COLUMN purpose text NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('login', 'enroll'));

CREATE INDEX auth_email_challenges_enrollment_idx ON auth_email_challenges
  (organization_id, member_id, created_at DESC)
  WHERE purpose = 'enroll' AND status IN ('pending', 'sending', 'sent');
