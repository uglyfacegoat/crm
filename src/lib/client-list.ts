import { z } from "zod";
import type { Client } from "@/lib/mock-data";

export const CLIENT_PAGE_SIZE = 50;

export const clientListQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  history: z.enum(["all", "with-orders", "without-orders"]).default("all"),
  kind: z.enum(["all", "Юр. лицо", "Физ. лицо"]).default("all"),
  minOrders: z.coerce.number().int().min(0).max(1000000).nullable().default(null),
  minObjects: z.coerce.number().int().min(0).max(1000000).nullable().default(null),
  sort: z.enum(["name", "orders-desc", "objects-desc"]).default("name"),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
});

export type ClientListQuery = z.infer<typeof clientListQuerySchema>;
export type ClientListSummary = { total: number; active: number; withoutOrders: number; objects: number; orders: number };
export type ClientListPage = { items: Client[]; total: number; page: number; pageSize: number; summary: ClientListSummary };

export function parseClientListSearchParams(params: URLSearchParams) {
  return clientListQuerySchema.safeParse({
    q: params.get("q") ?? undefined,
    history: params.get("history") ?? undefined,
    kind: params.get("kind") ?? undefined,
    minOrders: params.get("minOrders") || null,
    minObjects: params.get("minObjects") || null,
    sort: params.get("sort") ?? undefined,
    page: params.get("page") ?? undefined,
  });
}
