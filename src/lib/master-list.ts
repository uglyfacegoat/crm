import { z } from "zod";
import { masterStatusCodes, type MasterListItem, type MasterStatusCode } from "@/server/masters/types";

export const MASTER_PAGE_SIZE = 50;
export const masterListQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  status: z.enum(["all", ...masterStatusCodes]).default("all"),
  region: z.string().trim().max(160).default(""),
  zone: z.string().trim().max(160).default(""),
  skill: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});
export type MasterListQuery = z.infer<typeof masterListQuerySchema>;
export type MasterListPage = {
  items: MasterListItem[]; total: number; page: number; pageSize: number;
  counts: Partial<Record<MasterStatusCode | "all", number>>;
  facets: { regions: string[]; zones: string[]; skills: string[] };
};
export function parseMasterListSearchParams(params: URLSearchParams) {
  return masterListQuerySchema.safeParse(Object.fromEntries(["q", "status", "region", "zone", "skill", "page"].flatMap(key => params.has(key) ? [[key, params.get(key)]] : [])));
}
