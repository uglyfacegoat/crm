ALTER TABLE orders
  ADD CONSTRAINT orders_organization_id_id_client_id_unique
    UNIQUE (organization_id, id, client_id);

CREATE TABLE order_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id, client_id),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by) REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE order_group_members (
  organization_id uuid NOT NULL,
  group_id uuid NOT NULL,
  client_id uuid NOT NULL,
  order_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, order_id),
  UNIQUE (organization_id, group_id, order_id),
  FOREIGN KEY (organization_id, group_id, client_id)
    REFERENCES order_groups(organization_id, id, client_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, order_id, client_id)
    REFERENCES orders(organization_id, id, client_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX order_group_members_group_idx
  ON order_group_members (organization_id, group_id, created_at);
