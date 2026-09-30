-- Orders may be created before an object is known. Their documents still belong
-- to the order and client and must remain available in the archive.
ALTER TABLE documents ALTER COLUMN object_id DROP NOT NULL;
