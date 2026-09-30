import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { parseMoneyToMinorUnits } from "@/server/orders/money";
import type { CatalogItemInput } from "./schemas";

export type CatalogItem = {
  id: string; kind: "service" | "product"; name: string; description: string | null;
  sku: string | null; unit: string; priceMode: "fixed" | "variable";
  defaultPriceMinor: number | null; active: boolean; version: number;
};
export type CatalogUnit = { id: string; symbol: string; label: string; version: number };

const rowSchema = z.object({ id: z.string().uuid(), kind: z.enum(["service", "product"]), name: z.string(), description: z.string().nullable(), sku: z.string().nullable(), unit: z.string(), price_mode: z.enum(["fixed", "variable"]), default_price_minor: z.union([z.string(), z.number(), z.bigint()]).nullable(), active: z.boolean(), version: z.number().int().positive() });
function mapRow(row: unknown): CatalogItem {
  const value = rowSchema.parse(row);
  return { id: value.id, kind: value.kind, name: value.name, description: value.description, sku: value.sku, unit: value.unit, priceMode: value.price_mode, defaultPriceMinor: value.default_price_minor === null ? null : Number(value.default_price_minor), active: value.active, version: value.version };
}

export class CatalogConflictError extends Error { constructor() { super("Catalog item changed or duplicate name/SKU."); } }

export async function listCatalogItems(member: AuthenticatedMember, limit = 1000): Promise<CatalogItem[]> {
  requirePermission(member, "orders.read");
  const sql = getDatabase();
  const rows = await sql`SELECT id, kind, name, description, sku, unit, price_mode, default_price_minor, active, version FROM catalog_items WHERE organization_id = ${member.organizationId} ORDER BY active DESC, kind, name LIMIT ${Math.min(Math.max(limit, 1), 1000)}`;
  return rows.map(mapRow);
}

export const CATALOG_INVENTORY_PAGE_SIZE = 50;
export const catalogInventoryQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  filter: z.enum(["service", "product", "all", "archived"]).default("service"),
  page: z.coerce.number().int().min(0).max(1000).default(0),
});
export type CatalogInventoryQuery = z.infer<typeof catalogInventoryQuerySchema>;
export type ScopedCatalogItem = CatalogItem & { organizationId: string; organizationName: string };

export async function searchCatalogInventory(scopes: AuthenticatedMember[], query: CatalogInventoryQuery): Promise<{
  items: ScopedCatalogItem[]; hasMore: boolean; activeServiceCount: number;
}> {
  for (const scope of scopes) requirePermission(scope, "orders.read");
  if (!scopes.length) return { items: [], hasMore: false, activeServiceCount: 0 };
  const organizationIds = scopes.map((scope) => scope.organizationId);
  const sql = getDatabase();
  const [rows, counts] = await Promise.all([
    sql`SELECT items.id, items.organization_id, items.kind, items.name, items.description,
        items.sku, items.unit, items.price_mode, items.default_price_minor, items.active, items.version
      FROM catalog_items items JOIN organizations orgs ON orgs.id = items.organization_id
      WHERE items.organization_id = ANY(${organizationIds}::uuid[])
        AND (${query.filter} = 'archived' AND NOT items.active OR ${query.filter} <> 'archived' AND items.active)
        AND (${query.filter} IN ('all', 'archived') OR items.kind = ${query.filter})
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', items.name, items.sku, items.description, orgs.name), ${query.q}))
      ORDER BY items.name, items.organization_id, items.id
      LIMIT ${CATALOG_INVENTORY_PAGE_SIZE + 1} OFFSET ${query.page * CATALOG_INVENTORY_PAGE_SIZE}`,
    sql`SELECT count(*)::integer AS total FROM catalog_items
      WHERE organization_id = ANY(${organizationIds}::uuid[]) AND active AND kind = 'service'`,
  ]);
  const names = new Map(scopes.map((scope) => [scope.organizationId, scope.organizationName]));
  return {
    items: rows.slice(0, CATALOG_INVENTORY_PAGE_SIZE).map((row) => ({
      ...mapRow(row), organizationId: z.string().uuid().parse(row.organization_id),
      organizationName: names.get(z.string().uuid().parse(row.organization_id)) ?? "",
    })),
    hasMore: rows.length > CATALOG_INVENTORY_PAGE_SIZE,
    activeServiceCount: z.number().int().parse(counts[0]?.total ?? 0),
  };
}

export async function listCatalogUnits(member: AuthenticatedMember): Promise<CatalogUnit[]> {
  requirePermission(member, "orders.read");
  const rows = await getDatabase()`SELECT id, symbol, label, version FROM catalog_units
    WHERE organization_id = ${member.organizationId} AND active ORDER BY symbol`;
  return rows.map((row) => ({ id: z.string().uuid().parse(row.id), symbol: z.string().parse(row.symbol), label: z.string().parse(row.label), version: z.number().int().parse(row.version) }));
}

export async function saveCatalogUnit(member: AuthenticatedMember, input: { id?: string; expectedVersion?: number; symbol: string; label: string }) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  try {
    await sql.begin(async (transaction) => {
      if (input.id) {
        const [existing] = await transaction`SELECT symbol FROM catalog_units WHERE organization_id = ${member.organizationId}
          AND id = ${input.id} AND version = ${input.expectedVersion ?? -1} AND active FOR UPDATE`;
        if (!existing) throw new CatalogConflictError();
        await transaction`UPDATE catalog_units SET symbol = ${input.symbol}, label = ${input.label}, version = version + 1
          WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
        if (existing.symbol !== input.symbol) await transaction`UPDATE catalog_items SET unit = ${input.symbol}, version = version + 1, updated_at = now()
          WHERE organization_id = ${member.organizationId} AND unit = ${existing.symbol}`;
      } else {
        await transaction`INSERT INTO catalog_units (organization_id, symbol, label)
          VALUES (${member.organizationId}, ${input.symbol}, ${input.label})`;
      }
    });
  } catch (error) {
    if (error instanceof CatalogConflictError || (typeof error === "object" && error !== null && "code" in error && error.code === "23505")) throw new CatalogConflictError();
    throw error;
  }
}

export async function deleteCatalogUnit(member: AuthenticatedMember, id: string, expectedVersion: number) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  const rows = await sql`UPDATE catalog_units SET active = false, version = version + 1
    WHERE organization_id = ${member.organizationId} AND id = ${id} AND version = ${expectedVersion}
      AND NOT EXISTS (SELECT 1 FROM catalog_items WHERE organization_id = ${member.organizationId} AND unit = catalog_units.symbol)
    RETURNING id`;
  if (!rows.length) throw new CatalogConflictError();
}

export async function deleteCatalogItem(member: AuthenticatedMember, id: string, expectedVersion: number): Promise<"deleted" | "archived"> {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [item] = await transaction`SELECT id FROM catalog_items WHERE organization_id = ${member.organizationId}
      AND id = ${id} AND version = ${expectedVersion} FOR UPDATE`;
    if (!item) throw new CatalogConflictError();
    const [usage] = await transaction`SELECT
      (SELECT count(*) FROM order_services WHERE organization_id = ${member.organizationId} AND catalog_item_id = ${id})
      + (SELECT count(*) FROM object_service_rates WHERE organization_id = ${member.organizationId} AND catalog_item_id = ${id}) AS total`;
    if (Number(usage.total) === 0) {
      await transaction`DELETE FROM catalog_items WHERE organization_id = ${member.organizationId} AND id = ${id}`;
      return "deleted" as const;
    }
    await transaction`UPDATE catalog_items SET active = false, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${id}`;
    return "archived" as const;
  });
}

export async function saveCatalogItem(member: AuthenticatedMember, input: CatalogItemInput): Promise<CatalogItem> {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  const price = input.defaultPrice ? parseMoneyToMinorUnits(input.defaultPrice).toString() : null;
  try {
    const rows = input.id ? await sql`UPDATE catalog_items SET kind = ${input.kind}, name = ${input.name}, description = ${input.description}, sku = ${input.sku}, unit = ${input.unit}, price_mode = ${input.priceMode}, default_price_minor = ${price}, version = version + 1, updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${input.id} AND version = ${input.expectedVersion!} RETURNING id, kind, name, description, sku, unit, price_mode, default_price_minor, active, version`
      : await sql`INSERT INTO catalog_items (organization_id, kind, name, description, sku, unit, price_mode, default_price_minor) VALUES (${member.organizationId}, ${input.kind}, ${input.name}, ${input.description}, ${input.sku}, ${input.unit}, ${input.priceMode}, ${price}) RETURNING id, kind, name, description, sku, unit, price_mode, default_price_minor, active, version`;
    if (!rows[0]) throw new CatalogConflictError();
    return mapRow(rows[0]);
  } catch (error) {
    if (error instanceof CatalogConflictError || (typeof error === "object" && error !== null && "code" in error && error.code === "23505")) throw new CatalogConflictError();
    throw error;
  }
}

export async function setCatalogItemActive(member: AuthenticatedMember, id: string, expectedVersion: number, active: boolean): Promise<void> {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  const rows = await sql`UPDATE catalog_items SET active = ${active}, version = version + 1, updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${id} AND version = ${expectedVersion} RETURNING id`;
  if (!rows[0]) throw new CatalogConflictError();
}
