CREATE TABLE workflow_comments (
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 2 AND 2000),
  author_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, id),
  FOREIGN KEY (organization_id, map_id)
    REFERENCES workflow_maps(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, author_id)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX workflow_comments_recent_idx
  ON workflow_comments (organization_id, map_id, created_at DESC, id DESC);

CREATE FUNCTION reject_workflow_comment_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Workflow comments are immutable';
END;
$$;

CREATE TRIGGER workflow_comments_immutable
  BEFORE UPDATE OR DELETE ON workflow_comments
  FOR EACH ROW EXECUTE FUNCTION reject_workflow_comment_mutation();
