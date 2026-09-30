-- A client can be recorded before a telephone number or a site address is known.
ALTER TABLE client_contacts DROP CONSTRAINT IF EXISTS client_contacts_phone_check;
ALTER TABLE client_contacts ADD CONSTRAINT client_contacts_phone_check
  CHECK (phone = '' OR length(btrim(phone)) BETWEEN 7 AND 40);
ALTER TABLE client_contacts ALTER COLUMN normalized_phone DROP NOT NULL;
ALTER TABLE client_contacts ADD CONSTRAINT client_contacts_client_identity_unique UNIQUE (organization_id, client_id, id);

ALTER TABLE client_objects DROP CONSTRAINT IF EXISTS client_objects_address_check;
ALTER TABLE client_objects ADD CONSTRAINT client_objects_address_check
  CHECK (address = '' OR length(btrim(address)) BETWEEN 5 AND 500);
DROP INDEX client_objects_client_address_unique_idx;
CREATE UNIQUE INDEX client_objects_client_address_unique_idx
  ON client_objects (organization_id, client_id, lower(btrim(address))) WHERE btrim(address) <> '';

ALTER TABLE orders ADD COLUMN price_pending boolean NOT NULL DEFAULT false;

CREATE TABLE client_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  contact_id uuid,
  label text NOT NULL DEFAULT 'Дополнительный' CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  phone text NOT NULL CHECK (length(btrim(phone)) BETWEEN 7 AND 40),
  normalized_phone text NOT NULL CHECK (normalized_phone ~ '^\+[0-9]{10,15}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, client_id) REFERENCES clients(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, client_id, contact_id) REFERENCES client_contacts(organization_id, client_id, id) ON DELETE CASCADE,
  UNIQUE (organization_id, client_id, normalized_phone)
);
CREATE INDEX client_phone_numbers_client_idx ON client_phone_numbers (organization_id, client_id, created_at);

CREATE TABLE order_contacts (
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  PRIMARY KEY (organization_id, order_id, contact_id),
  UNIQUE (organization_id, order_id, position),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES client_contacts(organization_id, id) ON DELETE RESTRICT
);
INSERT INTO order_contacts (organization_id, order_id, contact_id, position)
  SELECT organization_id, id, client_contact_id, 1 FROM orders WHERE client_contact_id IS NOT NULL;

CREATE TABLE order_objects (
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  object_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  PRIMARY KEY (organization_id, order_id, object_id),
  UNIQUE (organization_id, order_id, position),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, object_id) REFERENCES client_objects(organization_id, id) ON DELETE RESTRICT
);
INSERT INTO order_objects (organization_id, order_id, object_id, position)
  SELECT organization_id, id, object_id, 1 FROM orders WHERE object_id IS NOT NULL;
