ALTER TABLE clients
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0);

ALTER TABLE client_contacts
  ADD COLUMN normalized_phone text;

UPDATE client_contacts
SET normalized_phone = CASE
  WHEN regexp_replace(phone, '\D', '', 'g') ~ '^8[0-9]{10}$'
    THEN '+7' || substring(regexp_replace(phone, '\D', '', 'g') FROM 2)
  WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
    THEN '+7' || regexp_replace(phone, '\D', '', 'g')
  ELSE '+' || regexp_replace(phone, '\D', '', 'g')
END;

ALTER TABLE client_contacts
  ALTER COLUMN normalized_phone SET NOT NULL,
  ADD CONSTRAINT client_contacts_normalized_phone_format
    CHECK (normalized_phone ~ '^\+[0-9]{10,15}$');

CREATE UNIQUE INDEX client_contacts_client_phone_unique_idx
  ON client_contacts (organization_id, client_id, normalized_phone);

CREATE UNIQUE INDEX client_objects_client_address_unique_idx
  ON client_objects (organization_id, client_id, lower(btrim(address)));
