import "server-only";
import { z } from "zod";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerResult } from "@/lib/order-picker";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const catalogPickerQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  objectId: z.string().uuid().optional(),
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
  contract_name: z.string().nullable(),
  contract_unit_price_minor: z.union([z.string(), z.number(), z.bigint()]).nullable(),
  billing_basis: z.enum(["area", "quantity", "fixed"]).nullable(),
});

export async function searchCatalogPicker(member: AuthenticatedMember, query: CatalogPickerQuery): Promise<OrderPickerResult> {
  requirePermission(member, "orders.read");
  const sql = getDatabase();
  const objectId = query.objectId ?? null;
  const selectedId = query.id ?? null;
  const rows = await sql`SELECT items.id, items.kind, items.name, items.unit, items.price_mode,
      items.default_price_minor, rate.name AS contract_name,
      rate.unit_price_minor AS contract_unit_price_minor, rate.billing_basis
    FROM catalog_items items
    LEFT JOIN LATERAL (
      SELECT name, unit_price_minor, billing_basis FROM object_service_rates
      WHERE organization_id = items.organization_id AND object_id = ${objectId}::uuid
        AND catalog_item_id = items.id AND line_kind = 'contract'
      ORDER BY position LIMIT 1
    ) rate ON true
    WHERE items.organization_id = ${member.organizationId}
      AND (items.active OR items.id = ${selectedId}::uuid)
      AND (${selectedId}::uuid IS NULL OR items.id = ${selectedId}::uuid)
      AND (${selectedId}::uuid IS NOT NULL OR ${query.q} = '' OR crm_search_matches(concat_ws(' ', items.name, items.sku, items.description, rate.name), ${query.q}))
    ORDER BY items.kind, items.name, items.id LIMIT ${ORDER_PICKER_PAGE_SIZE + 1}`;
  return {
    items: rows.slice(0, ORDER_PICKER_PAGE_SIZE).map((raw) => {
      const row = rowSchema.parse(raw);
      const basePrice = row.default_price_minor === null ? null : Number(row.default_price_minor);
      const contractPrice = row.contract_unit_price_minor === null ? null : Number(row.contract_unit_price_minor);
      const price = contractPrice ?? basePrice;
      const detail = `${row.contract_name && row.contract_name !== row.name ? `Каталог: ${row.name} · ` : ""}${row.kind === "product" ? "Товар" : "Услуга"} · ${price === null ? "цена уточняется" : `${(price / 100).toFixed(2)} ₽/${row.billing_basis === "area" ? "м²" : row.unit}`}${contractPrice !== null ? " · по договору" : ""}`;
      return {
        id: row.id,
        name: row.contract_name ?? row.name,
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
