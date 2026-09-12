CREATE FUNCTION crm_search_normalize(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    replace(lower(coalesce(value, '')), 'ё', 'е'),
    '[[:punct:][:space:]]+',
    ' ',
    'g'
  ));
$$;

CREATE FUNCTION crm_search_matches(value text, query text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM regexp_split_to_table(crm_search_normalize(query), '[[:space:]]+') AS search_terms(term)
    WHERE search_terms.term <> ''
      AND position(search_terms.term IN crm_search_normalize(value)) = 0
  );
$$;
