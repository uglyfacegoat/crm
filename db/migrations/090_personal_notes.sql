CREATE TABLE personal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_organization_id uuid NOT NULL,
  owner_member_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('dashboard', 'order', 'client')),
  target_organization_id uuid,
  target_id uuid,
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 160),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_organization_id, owner_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE,
  CHECK ((target_kind = 'dashboard' AND target_organization_id IS NULL AND target_id IS NULL)
    OR (target_kind <> 'dashboard' AND target_organization_id IS NOT NULL AND target_id IS NOT NULL))
);
CREATE INDEX personal_notes_target_idx ON personal_notes
  (owner_organization_id, owner_member_id, target_kind, target_organization_id, target_id, updated_at DESC);

CREATE TABLE personal_note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_organization_id uuid NOT NULL,
  owner_member_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_organization_id, owner_member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX personal_note_templates_owner_idx ON personal_note_templates
  (owner_organization_id, owner_member_id, created_at DESC);
