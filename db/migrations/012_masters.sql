ALTER TABLE masters
  ADD COLUMN normalized_phone text,
  ADD COLUMN service_zone text,
  ADD COLUMN base_payment_minor bigint,
  ADD COLUMN daily_capacity smallint NOT NULL DEFAULT 4,
  ADD COLUMN skills text[] NOT NULL DEFAULT '{}',
  ADD COLUMN notes text,
  ADD COLUMN version integer NOT NULL DEFAULT 1;

UPDATE masters
SET normalized_phone = CASE
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
        AND left(regexp_replace(phone, '\D', '', 'g'), 1) = '8'
        THEN '+7' || substring(regexp_replace(phone, '\D', '', 'g') FROM 2)
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
        THEN '+7' || regexp_replace(phone, '\D', '', 'g')
      ELSE '+' || regexp_replace(phone, '\D', '', 'g')
    END,
    service_zone = service_region;

ALTER TABLE masters
  ALTER COLUMN normalized_phone SET NOT NULL,
  ALTER COLUMN service_zone SET NOT NULL,
  ADD CONSTRAINT masters_normalized_phone_format
    CHECK (normalized_phone ~ '^\+[0-9]{10,15}$'),
  ADD CONSTRAINT masters_service_region_length
    CHECK (length(btrim(service_region)) BETWEEN 2 AND 160),
  ADD CONSTRAINT masters_service_zone_length
    CHECK (length(btrim(service_zone)) BETWEEN 1 AND 160),
  ADD CONSTRAINT masters_base_payment_nonnegative
    CHECK (base_payment_minor IS NULL OR base_payment_minor >= 0),
  ADD CONSTRAINT masters_daily_capacity_range
    CHECK (daily_capacity BETWEEN 1 AND 20),
  ADD CONSTRAINT masters_skills_limit
    CHECK (cardinality(skills) <= 30),
  ADD CONSTRAINT masters_notes_length
    CHECK (notes IS NULL OR length(notes) <= 4000),
  ADD CONSTRAINT masters_version_positive
    CHECK (version > 0);

CREATE UNIQUE INDEX masters_organization_phone_unique_idx
  ON masters (organization_id, normalized_phone);

CREATE INDEX masters_zone_idx
  ON masters (organization_id, service_region, service_zone)
  WHERE active;
