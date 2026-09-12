import { matchesSearchText } from "./search-normalization.ts";

export type SearchablePickerOption = {
  label: string;
  detail?: string;
};

export function filterPickerOptions<Option extends SearchablePickerOption>(options: Option[], query: string): Option[] {
  return options.filter((option) => matchesSearchText(query, [option.label, option.detail]));
}
