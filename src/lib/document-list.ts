import { z } from "zod";
import { documentCategories, type DocumentListItem } from "@/server/documents/types";

const flag = z.union([z.boolean(), z.enum(["0", "1"])]).default(false).transform(value => value === true || value === "1");
export const DOCUMENT_PAGE_SIZE = 50;
export const documentListQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  clientId: z.string().uuid().nullable().default(null), objectId: z.string().uuid().nullable().default(null),
  orderId: z.string().uuid().nullable().default(null), folderId: z.string().uuid().nullable().default(null),
  archiveCategory: z.enum(documentCategories).nullable().default(null),
  favoriteOnly: flag, rootOnly: flag,
  category: z.enum(["all", ...documentCategories]).default("all"),
  favorite: z.enum(["all", "favorite", "plain"]).default("all"),
  dateFrom: z.iso.date().nullable().default(null), dateTo: z.iso.date().nullable().default(null),
  sort: z.enum(["newest", "oldest", "size-desc", "size-asc"]).default("newest"),
  scope: z.enum(["all", "own"]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: "Неверный диапазон дат", path: ["dateTo"] });
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;
export type DocumentListPage = { items: DocumentListItem[]; total: number; scopeTotal: number; page: number; pageSize: number };
export function documentListParams(query: DocumentListQuery) {
  return new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === null ? [] : [[key, typeof value === "boolean" ? value ? "1" : "0" : String(value)]]));
}
export function parseDocumentListSearchParams(params: URLSearchParams) {
  return documentListQuerySchema.safeParse(Object.fromEntries(Object.keys(documentListQuerySchema.shape).flatMap(key => params.has(key) ? [[key, params.get(key)]] : [])));
}
