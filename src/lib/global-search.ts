import { z } from "zod";

export const globalSearchEntityTypes = ["order", "client", "object", "visit", "document", "master", "contract"] as const;

export const globalSearchQuerySchema = z.string()
  .transform((value) => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(2, "Введите не меньше 2 символов.").max(100, "Запрос не должен превышать 100 символов."));

export const globalSearchResultSchema = z.object({
  id: z.string().min(1),
  entityType: z.enum(globalSearchEntityTypes),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  detail: z.string().nullable(),
  href: z.string().startsWith("/"),
  matchedBy: z.string().min(1),
});

export const globalSearchResponseSchema = z.object({
  data: z.object({
    query: z.string(),
    results: z.array(globalSearchResultSchema),
  }),
});

export type GlobalSearchResult = z.infer<typeof globalSearchResultSchema>;

export function parseSearchDate(value: string): string | null {
  const normalized = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const russianMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
  const parts = isoMatch
    ? { year: Number(isoMatch[1]), month: Number(isoMatch[2]), day: Number(isoMatch[3]) }
    : russianMatch
      ? { year: Number(russianMatch[3]), month: Number(russianMatch[2]), day: Number(russianMatch[1]) }
      : null;
  if (!parts) return null;

  const candidate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (candidate.getUTCFullYear() !== parts.year || candidate.getUTCMonth() !== parts.month - 1 || candidate.getUTCDate() !== parts.day) return null;
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function escapeSearchPattern(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function getSearchDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits : null;
}
