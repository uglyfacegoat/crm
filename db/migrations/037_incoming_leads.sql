ALTER TABLE website_leads
  ADD COLUMN moderation_status text NOT NULL DEFAULT 'new'
    CHECK (moderation_status IN ('new', 'reviewing', 'accepted', 'rejected')),
  ADD COLUMN review_note text,
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT website_leads_reviewer_fk
    FOREIGN KEY (organization_id, reviewed_by)
    REFERENCES organization_members(organization_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT website_leads_review_state_check CHECK (
    (moderation_status IN ('new', 'reviewing') AND reviewed_at IS NULL)
    OR (moderation_status IN ('accepted', 'rejected') AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL)
  );

CREATE INDEX website_leads_moderation_idx
  ON website_leads (organization_id, moderation_status, received_at DESC);

CREATE UNIQUE INDEX orders_source_lead_unique_idx
  ON orders (organization_id, source_lead_id)
  WHERE source_lead_id IS NOT NULL;

