-- An order may be captured from a name, phone and agreed price before its
-- address and object are known. Visits still require a real client object.
ALTER TABLE orders ALTER COLUMN object_id DROP NOT NULL;
