ALTER TABLE clients
  ADD COLUMN kind text NOT NULL DEFAULT 'legal_entity' CHECK (kind IN ('legal_entity', 'individual'));

CREATE UNIQUE INDEX clients_organization_tax_id_unique_idx
  ON clients (organization_id, tax_id)
  WHERE tax_id IS NOT NULL;

CREATE TABLE client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 200),
  position text,
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 7 AND 40),
  email text CHECK (email IS NULL OR email = lower(email)),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX client_contacts_one_primary_idx
  ON client_contacts (organization_id, client_id)
  WHERE is_primary;

CREATE INDEX client_contacts_client_idx ON client_contacts (organization_id, client_id, created_at);

CREATE TABLE idempotency_requests (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  operation text NOT NULL CHECK (length(btrim(operation)) BETWEEN 3 AND 100),
  entity_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (organization_id, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE INDEX idempotency_requests_cleanup_idx ON idempotency_requests (expires_at);
