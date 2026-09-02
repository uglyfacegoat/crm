ALTER TABLE contracts
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN renewed_from_contract_id uuid,
  ADD COLUMN created_by uuid,
  ADD COLUMN updated_by uuid,
  ADD CONSTRAINT contracts_renewed_from_fk
    FOREIGN KEY (organization_id, renewed_from_contract_id)
    REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT contracts_created_by_fk
    FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT contracts_updated_by_fk
    FOREIGN KEY (organization_id, updated_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX contracts_idempotency_unique_idx
  ON contracts (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX contracts_single_renewal_idx
  ON contracts (organization_id, renewed_from_contract_id)
  WHERE renewed_from_contract_id IS NOT NULL;

CREATE INDEX contracts_client_period_idx
  ON contracts (organization_id, client_id, starts_on DESC);

ALTER TABLE contract_schedule_rules
  ADD COLUMN starts_on date,
  ADD COLUMN ends_on date,
  ADD COLUMN duration_minutes smallint NOT NULL DEFAULT 120 CHECK (duration_minutes BETWEEN 15 AND 1440),
  ADD COLUMN default_master_id uuid,
  ADD COLUMN notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN created_by uuid,
  ADD COLUMN updated_by uuid,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT contract_schedule_rules_master_fk
    FOREIGN KEY (organization_id, default_master_id)
    REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT contract_schedule_rules_created_by_fk
    FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT contract_schedule_rules_updated_by_fk
    FOREIGN KEY (organization_id, updated_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT;

UPDATE contract_schedule_rules rules
SET starts_on = contracts.starts_on,
    ends_on = contracts.ends_on
FROM contracts
WHERE contracts.organization_id = rules.organization_id
  AND contracts.id = rules.contract_id;

ALTER TABLE contract_schedule_rules
  ALTER COLUMN starts_on SET NOT NULL,
  ALTER COLUMN ends_on SET NOT NULL,
  ADD CONSTRAINT contract_schedule_rules_period_check CHECK (ends_on >= starts_on),
  ADD CONSTRAINT contract_schedule_rules_contract_unique UNIQUE (organization_id, contract_id);

CREATE TABLE contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'status_changed', 'renewed')),
  before_state jsonb,
  after_state jsonb NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, actor_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX contract_events_contract_idx
  ON contract_events (organization_id, contract_id, created_at DESC, id DESC);

INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, after_state, created_at)
SELECT organization_id, id, created_by, 'created',
  jsonb_build_object(
    'contractNumber', contract_number,
    'status', status,
    'startsOn', starts_on,
    'endsOn', ends_on,
    'renewalNoticeDays', renewal_notice_days,
    'version', 1
  ),
  created_at
FROM contracts;
