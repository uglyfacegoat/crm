import "server-only";
import { z } from "zod";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerResult } from "@/lib/order-picker";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const catalogPickerQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
});

export type CatalogPickerQuery = z.infer<typeof catalogPickerQuerySchema>;

const rowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["service", "product"]),
  name: z.string(),
  unit: z.string(),
  price_mode: z.enum(["fixed", "variable"]),
  default_price_minor: z.union([z.string(), z.number(), z.bigint()]).nullable(),

});

export async function searchCatalogPicker(member: AuthenticatedMember, query: CatalogPickerQuery): Promise<OrderPickerResult> {
  requirePermission(member, "orders.read");
  const sql = getDatabase();
  const selectedId = query.id ?? null;
  const rows = await sql`SELECT items.id, items.kind, items.name, items.unit, items.price_mode,
      items.default_price_minor FROM catalog_items items
    WHERE items.organization_id = ${member.organizationId}
      AND (items.active OR items.id = ${selectedId}::uuid)
      AND (${selectedId}::uuid IS NULL OR items.id = ${selectedId}::uuid)
      AND (${selectedId}::uuid IS NOT NULL OR ${query.q} = '' OR crm_search_matches(concat_ws(' ', items.name, items.sku, items.description), ${query.q}))
    ORDER BY items.kind, items.name, items.id LIMIT ${ORDER_PICKER_PAGE_SIZE + 1}`;
  return {
    items: rows.slice(0, ORDER_PICKER_PAGE_SIZE).map((raw) => {
      const row = rowSchema.parse(raw);
      const basePrice = row.default_price_minor === null ? null : Number(row.default_price_minor);
      const detail = `${row.kind === "product" ? "Товар" : "Услуга"} · ${basePrice === null ? "цена уточняется" : `${(basePrice / 100).toFixed(2)} ₽/${row.unit}`}`;
      return {
        id: row.id,
        name: row.name,
        detail,
        catalogItem: {
          id: row.id,
          kind: row.kind,
          name: row.name,
          unit: row.unit,
          priceMode: row.price_mode,
          defaultPriceMinor: basePrice,
        },
      };
    }),
    hasMore: rows.length > ORDER_PICKER_PAGE_SIZE,
  };
}
