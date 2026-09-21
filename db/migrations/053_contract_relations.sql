CREATE TABLE contract_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contract_a_id uuid NOT NULL,
  contract_b_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('related', 'supplement', 'framework')),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contract_a_id < contract_b_id),
  CONSTRAINT contract_relations_pair_unique UNIQUE (organization_id, contract_a_id, contract_b_id),
  FOREIGN KEY (organization_id, contract_a_id) REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, contract_b_id) REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX contract_relations_contract_b_idx
  ON contract_relations (organization_id, contract_b_id);
