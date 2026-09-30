CREATE TABLE workflow_map_revisions (
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 120),
  description text NOT NULL CHECK (length(description) <= 1000),
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  change_kind text NOT NULL CHECK (change_kind IN ('created', 'saved', 'restored', 'archived', 'baseline')),
  source_version integer CHECK (source_version > 0),
  saved_by uuid NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, map_id, version),
  FOREIGN KEY (organization_id, map_id)
    REFERENCES workflow_maps(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, saved_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX workflow_map_revisions_recent_idx
  ON workflow_map_revisions (organization_id, map_id, version DESC);

-- Maps created by the previous release retain their current state as the
-- earliest provable snapshot; earlier edits cannot be reconstructed.
INSERT INTO workflow_map_revisions
  (organization_id, map_id, version, title, description, draft,
   change_kind, saved_by, saved_at)
SELECT organization_id, id, version, title, description, draft,
  'baseline', updated_by, updated_at
FROM workflow_maps;

CREATE FUNCTION reject_workflow_revision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workflow revisions are immutable';
END;
$$;

CREATE TRIGGER workflow_map_revisions_immutable
  BEFORE UPDATE OR DELETE ON workflow_map_revisions
  FOR EACH ROW EXECUTE FUNCTION reject_workflow_revision_mutation();

ALTER TABLE workflow_maps
  ADD COLUMN review_version integer CHECK (review_version > 0),
  ADD COLUMN review_requested_by uuid,
  ADD COLUMN review_requested_at timestamptz,
  ADD COLUMN approved_version integer CHECK (approved_version > 0),
  ADD COLUMN approved_by uuid,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN published_version integer CHECK (published_version > 0),
  ADD COLUMN published_by uuid,
  ADD COLUMN published_at timestamptz,
  ADD CONSTRAINT workflow_review_fields_consistent CHECK (
    (review_version IS NULL AND review_requested_by IS NULL AND review_requested_at IS NULL)
    OR (review_version IS NOT NULL AND review_requested_by IS NOT NULL AND review_requested_at IS NOT NULL)
  ),
  ADD CONSTRAINT workflow_approval_fields_consistent CHECK (
    (approved_version IS NULL AND approved_by IS NULL AND approved_at IS NULL)
    OR (approved_version IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT workflow_publication_fields_consistent CHECK (
    (published_version IS NULL AND published_by IS NULL AND published_at IS NULL)
    OR (published_version IS NOT NULL AND published_by IS NOT NULL AND published_at IS NOT NULL)
  ),
  ADD CONSTRAINT workflow_approved_review_match CHECK (
    approved_version IS NULL OR approved_version = review_version
  ),
  ADD CONSTRAINT workflow_reviewer_separation CHECK (
    approved_by IS NULL OR approved_by <> review_requested_by
  ),
  ADD CONSTRAINT workflow_review_revision_fk FOREIGN KEY (organization_id, id, review_version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version),
  ADD CONSTRAINT workflow_approval_revision_fk FOREIGN KEY (organization_id, id, approved_version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version),
  ADD CONSTRAINT workflow_publication_revision_fk FOREIGN KEY (organization_id, id, published_version)
    REFERENCES workflow_map_revisions(organization_id, map_id, version),
  ADD CONSTRAINT workflow_review_member_fk FOREIGN KEY (organization_id, review_requested_by)
    REFERENCES organization_members(organization_id, id),
  ADD CONSTRAINT workflow_approval_member_fk FOREIGN KEY (organization_id, approved_by)
    REFERENCES organization_members(organization_id, id),
  ADD CONSTRAINT workflow_publication_member_fk FOREIGN KEY (organization_id, published_by)
    REFERENCES organization_members(organization_id, id);
