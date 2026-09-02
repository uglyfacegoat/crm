CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX clients_global_search_idx ON clients USING gin (
  lower(legal_name || ' ' || coalesce(tax_id, '') || ' ' || coalesce(primary_phone, '') || ' ' || coalesce(primary_email, '')) gin_trgm_ops
);

CREATE INDEX client_contacts_global_search_idx ON client_contacts USING gin (
  lower(full_name || ' ' || phone || ' ' || coalesce(email, '')) gin_trgm_ops
);

CREATE INDEX client_objects_global_search_idx ON client_objects USING gin (
  lower(name || ' ' || address || ' ' || coalesce(onsite_contact, '')) gin_trgm_ops
);

CREATE INDEX orders_global_search_idx ON orders USING gin (
  lower(order_number || ' ' || client_name_snapshot || ' ' || object_name_snapshot || ' ' || object_address_snapshot || ' ' || coalesce(contact_name_snapshot, '') || ' ' || coalesce(contact_phone_snapshot, '') || ' ' || coalesce(master_name_snapshot, '')) gin_trgm_ops
);

CREATE INDEX documents_global_search_idx ON documents USING gin (
  lower(title || ' ' || coalesce(description, '')) gin_trgm_ops
) WHERE archived_at IS NULL;

CREATE INDEX document_versions_filename_search_idx ON document_versions USING gin (lower(original_filename) gin_trgm_ops);

CREATE INDEX masters_global_search_idx ON masters USING gin (
  lower(full_name || ' ' || phone || ' ' || normalized_phone || ' ' || coalesce(messenger, '') || ' ' || service_region || ' ' || service_zone) gin_trgm_ops
);

CREATE INDEX service_visits_global_search_idx ON service_visits USING gin (
  lower(client_name_snapshot || ' ' || object_name_snapshot || ' ' || object_address_snapshot || ' ' || coalesce(master_name_snapshot, '')) gin_trgm_ops
);
