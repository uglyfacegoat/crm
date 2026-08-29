CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  timezone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 2 AND 200),
  email text NOT NULL CHECK (email = lower(email)),
  role text NOT NULL CHECK (role IN ('admin', 'dispatcher', 'manager', 'accountant', 'master')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email),
  UNIQUE (organization_id, id)
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 2 AND 300),
  tax_id text,
  primary_phone text,
  primary_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX clients_organization_name_idx ON clients (organization_id, legal_name);
CREATE INDEX clients_organization_tax_id_idx ON clients (organization_id, tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE client_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 240),
  object_type text NOT NULL CHECK (length(btrim(object_type)) BETWEEN 2 AND 100),
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 5 AND 500),
  area_square_meters numeric(12,2) CHECK (area_square_meters > 0),
  floor_count integer CHECK (floor_count > 0),
  access_instructions text,
  parking_notes text,
  onsite_contact text,
  restrictions text,
  risk_level smallint CHECK (risk_level BETWEEN 1 AND 5),
  infestation_level smallint CHECK (infestation_level BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX client_objects_client_idx ON client_objects (organization_id, client_id);
CREATE INDEX client_objects_address_idx ON client_objects (organization_id, address);

CREATE TABLE object_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  object_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  risk_notes text,
  last_activity_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, object_id, name)
);

CREATE TABLE masters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 2 AND 200),
  phone text NOT NULL,
  messenger text,
  service_region text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE INDEX masters_region_idx ON masters (organization_id, service_region) WHERE active;

CREATE TABLE websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 200),
  domain text NOT NULL CHECK (domain = lower(domain) AND domain !~ '[/?#]'),
  status text NOT NULL CHECK (status IN ('setup', 'active', 'attention', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, domain),
  UNIQUE (organization_id, id)
);

CREATE TABLE website_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('yandex_metrica', 'ga4', 'google_search_console', 'yandex_webmaster')),
  external_property_id text NOT NULL,
  credential_secret_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  last_successful_sync_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, website_id, provider)
);

CREATE TABLE website_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  external_event_id text NOT NULL,
  received_at timestamptz NOT NULL,
  contact_name text,
  phone text,
  email text,
  service_interest text,
  landing_url text,
  referrer_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, website_id, external_event_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX website_leads_received_idx ON website_leads (organization_id, website_id, received_at DESC);
CREATE INDEX website_leads_phone_idx ON website_leads (organization_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  object_id uuid NOT NULL,
  source_lead_id uuid,
  order_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('new', 'approval', 'scheduled', 'in_progress', 'completed', 'overdue', 'cancelled')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  agreed_total_minor bigint NOT NULL DEFAULT 0 CHECK (agreed_total_minor >= 0),
  invoiced_total_minor bigint NOT NULL DEFAULT 0 CHECK (invoiced_total_minor >= 0),
  paid_total_minor bigint NOT NULL DEFAULT 0 CHECK (paid_total_minor >= 0),
  assigned_master_id uuid,
  master_payment_snapshot_minor bigint CHECK (master_payment_snapshot_minor >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_lead_id) REFERENCES website_leads(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_master_id) REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, order_number),
  UNIQUE (organization_id, id)
);

CREATE INDEX orders_object_idx ON orders (organization_id, object_id, created_at DESC);
CREATE INDEX orders_source_lead_idx ON orders (organization_id, source_lead_id) WHERE source_lead_id IS NOT NULL;

CREATE TABLE order_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  service_name_snapshot text NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE order_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 2 AND 80),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  occurred_on date NOT NULL,
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX order_expenses_order_idx ON order_expenses (organization_id, order_id, occurred_on);

CREATE TABLE contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  object_id uuid NOT NULL,
  contract_number text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'suspended', 'completed', 'cancelled')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  renewal_notice_days smallint NOT NULL CHECK (renewal_notice_days BETWEEN 1 AND 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, contract_number),
  UNIQUE (organization_id, id)
);

CREATE INDEX contracts_renewal_idx ON contracts (organization_id, ends_on) WHERE status = 'active';

CREATE TABLE contract_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  frequency_unit text NOT NULL CHECK (frequency_unit IN ('day', 'week', 'month', 'year')),
  frequency_interval smallint NOT NULL CHECK (frequency_interval BETWEEN 1 AND 52),
  local_time time NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE TABLE service_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid,
  contract_id uuid,
  schedule_rule_id uuid,
  object_id uuid NOT NULL,
  assigned_master_id uuid,
  scheduled_start_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'confirmed', 'in_progress', 'completed', 'cancelled')),
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR contract_id IS NOT NULL),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, contract_id) REFERENCES contracts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assigned_master_id) REFERENCES masters(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, schedule_rule_id) REFERENCES contract_schedule_rules(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, contract_id, scheduled_start_at)
);

CREATE INDEX service_visits_schedule_idx ON service_visits (organization_id, scheduled_start_at, status);

CREATE TABLE website_daily_metrics (
  organization_id uuid NOT NULL,
  website_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('yandex_metrica', 'ga4', 'google_search_console', 'yandex_webmaster', 'crm')),
  metric_date date NOT NULL,
  visitors bigint NOT NULL DEFAULT 0 CHECK (visitors >= 0),
  sessions bigint NOT NULL DEFAULT 0 CHECK (sessions >= 0),
  pageviews bigint NOT NULL DEFAULT 0 CHECK (pageviews >= 0),
  goal_completions bigint NOT NULL DEFAULT 0 CHECK (goal_completions >= 0),
  search_clicks bigint NOT NULL DEFAULT 0 CHECK (search_clicks >= 0),
  search_impressions bigint NOT NULL DEFAULT 0 CHECK (search_impressions >= 0),
  leads bigint NOT NULL DEFAULT 0 CHECK (leads >= 0),
  paid_orders bigint NOT NULL DEFAULT 0 CHECK (paid_orders >= 0),
  paid_revenue_minor bigint NOT NULL DEFAULT 0 CHECK (paid_revenue_minor >= 0),
  operating_contribution_minor bigint NOT NULL DEFAULT 0,
  imported_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, website_id) REFERENCES websites(organization_id, id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, website_id, provider, metric_date)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  request_id text,
  changes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, actor_id) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX audit_events_entity_idx ON audit_events (organization_id, entity_type, entity_id, created_at DESC);
