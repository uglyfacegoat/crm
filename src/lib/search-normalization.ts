type SearchableValue = string | number | null | undefined;

export function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getSearchTokens(value: string) {
  const normalized = normalizeSearchText(value);
  return normalized ? normalized.split(" ") : [];
}

export function matchesSearchText(query: string, values: readonly SearchableValue[]) {
  const tokens = getSearchTokens(query);
  if (!tokens.length) return true;

  const searchableText = normalizeSearchText(values.flatMap((value) => value === null || value === undefined ? [] : [String(value)]).join(" "));
  const compactSearchableText = searchableText.replace(/\s/g, "");

  return tokens.every((token) => searchableText.includes(token) || (token.length >= 4 && compactSearchableText.includes(token)));
}
