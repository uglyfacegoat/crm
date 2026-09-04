export type SearchablePickerOption = {
  label: string;
  detail?: string;
};

function normalizeCompact(value: string) {
  return value.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function filterPickerOptions<Option extends SearchablePickerOption>(options: Option[], query: string): Option[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  if (!normalizedQuery) return options;

  const compactQuery = normalizeCompact(normalizedQuery);
  return options.filter((option) => {
    const searchableText = `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase("ru");
    return searchableText.includes(normalizedQuery) || normalizeCompact(searchableText).includes(compactQuery);
  });
}
