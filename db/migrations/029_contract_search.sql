CREATE INDEX contracts_global_search_idx ON contracts USING gin (
  lower(contract_number || ' ' || coalesce(notes, '')) gin_trgm_ops
);
