import { z } from "zod";
import type { ContractListItem, ContractSnapshot } from "@/server/contracts/types";

export const CONTRACT_PAGE_SIZE = 50;
export const contractListQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  quick: z.enum(["all", "active", "expiring", "scheduled"]).default("all"),
  status: z.enum(["all", "draft", "active", "suspended", "completed", "cancelled"]).default("all"),
  schedule: z.enum(["all", "scheduled", "unscheduled"]).default("all"),
  expiry: z.enum(["all", "attention", "expired"]).default("all"),
  dateFrom: z.iso.date().optional(), dateTo: z.iso.date().optional(),
  master: z.string().uuid().optional(),
  sort: z.enum(["expiry-asc", "expiry-desc", "newest", "oldest"]).default("expiry-asc"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
}).refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, { message: "Начальная дата позже конечной." });
export type ContractListQuery = z.infer<typeof contractListQuerySchema>;
export type ContractListPage = {
  items: ContractListItem[]; total: number; page: number; pageSize: number;
  summary: ContractSnapshot["summary"] & { scheduledContracts: number };
};
export function parseContractListSearchParams(params: URLSearchParams) {
  return contractListQuerySchema.safeParse(Object.fromEntries([
    "q", "quick", "status", "schedule", "expiry", "dateFrom", "dateTo", "master", "sort", "page",
  ].flatMap(key => params.has(key) ? [[key, params.get(key)]] : [])));
}
