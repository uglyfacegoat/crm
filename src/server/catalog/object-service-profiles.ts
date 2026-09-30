import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { parseMoneyToMinorUnits } from "@/server/orders/money";
import type { ObjectServiceProfileInput } from "./profile-schemas";

export type ObjectServiceRate = {
  id: string; catalogItemId: string | null; name: string; lineKind: "contract" | "request";
  billingBasis: "area" | "quantity" | "fixed"; quantity: string; unitPriceMinor: number | null;
};
export type ObjectServiceProfile = {
  organizationId: string; objectId: string; objectName: string; clientId: string; clientName: string;
  address: string; areaSquareMeters: string | null; objectAreaSquareMeters: string | null;
  visitsPerMonth: number | null; serviceSchedule: string; contractTotalMinor: number | null;
  notes: string; version: number; latestOrderId: string | null; nextVisitAt: string | null;
  rates: ObjectServiceRate[];
};
export type ScopedObjectServiceProfile = ObjectServiceProfile & { organizationName: string };
export const OBJECT_PROFILE_PAGE_SIZE = 50;
export const objectProfileQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(0).max(1000).default(0),
  id: z.string().uuid().optional(),
});
export type ObjectProfileQuery = z.infer<typeof objectProfileQuerySchema>;

export async function searchObjectServiceProfiles(scopes: AuthenticatedMember[], query: ObjectProfileQuery): Promise<{
  items: ScopedObjectServiceProfile[]; hasMore: boolean; configuredCount: number;
}> {
  for (const scope of scopes) requirePermission(scope, "orders.read");
  if (!scopes.length) return { items: [], hasMore: false, configuredCount: 0 };
  const sql = getDatabase();
  const organizationIds = scopes.map((scope) => scope.organizationId);
  const [rows, counts] = await Promise.all([
    sql`SELECT objects.organization_id, objects.id AS object_id, objects.name AS object_name,
      objects.client_id, objects.address, objects.area_square_meters::text AS object_area_square_meters,
      clients.legal_name AS client_name, profiles.area_square_meters::text AS profile_area_square_meters,
      profiles.visits_per_month, profiles.service_schedule, profiles.contract_total_minor,
      profiles.notes, coalesce(profiles.version, 0) AS version,
      (SELECT orders.id FROM orders WHERE orders.organization_id = objects.organization_id AND orders.object_id = objects.id
        ORDER BY orders.created_at DESC LIMIT 1) AS latest_order_id,
      (SELECT visits.scheduled_start_at FROM service_visits visits WHERE visits.organization_id = objects.organization_id
        AND visits.object_id = objects.id AND visits.status NOT IN ('completed', 'cancelled')
        AND visits.scheduled_start_at >= now() ORDER BY visits.scheduled_start_at LIMIT 1) AS next_visit_at
    FROM client_objects objects
    JOIN clients ON clients.organization_id = objects.organization_id AND clients.id = objects.client_id
    LEFT JOIN object_service_profiles profiles ON profiles.organization_id = objects.organization_id AND profiles.object_id = objects.id
    JOIN organizations orgs ON orgs.id = objects.organization_id
    WHERE objects.organization_id = ANY(${organizationIds}::uuid[])
      AND (${query.id ?? null}::uuid IS NULL OR objects.id = ${query.id ?? null}::uuid)
      AND (${query.id ?? null}::uuid IS NOT NULL OR ${query.q} = '' OR
        crm_search_matches(concat_ws(' ', clients.legal_name, objects.name, objects.address, orgs.name), ${query.q}))
    ORDER BY CASE
      WHEN ${query.q} <> '' AND position(crm_search_normalize(${query.q}) IN crm_search_normalize(objects.name)) > 0 THEN 0
      WHEN ${query.q} <> '' AND position(crm_search_normalize(${query.q}) IN crm_search_normalize(clients.legal_name)) > 0 THEN 1
      ELSE 2 END,
      clients.legal_name, objects.name, objects.organization_id, objects.id
    LIMIT ${OBJECT_PROFILE_PAGE_SIZE + 1} OFFSET ${query.id ? 0 : query.page * OBJECT_PROFILE_PAGE_SIZE}`,
    sql`SELECT count(*)::integer AS total FROM object_service_profiles
      WHERE organization_id = ANY(${organizationIds}::uuid[])`,
  ]);
  const selected = rows.slice(0, OBJECT_PROFILE_PAGE_SIZE);
  const ids = selected.map((row) => row.object_id as string);
  const rateRows = ids.length ? await sql`SELECT id, object_id, catalog_item_id, name, line_kind,
    billing_basis, quantity::text, unit_price_minor FROM object_service_rates
    WHERE organization_id = ANY(${organizationIds}::uuid[]) AND object_id = ANY(${ids}::uuid[])
    ORDER BY object_id, position` : [];
  const ratesByObject = new Map<string, ObjectServiceRate[]>();
  for (const row of rateRows) {
    const id = row.object_id as string;
    const rates = ratesByObject.get(id) ?? [];
    rates.push({ id: row.id as string, catalogItemId: row.catalog_item_id as string | null,
      name: row.name as string, lineKind: row.line_kind as "contract" | "request",
      billingBasis: row.billing_basis as "area" | "quantity" | "fixed", quantity: row.quantity as string,
      unitPriceMinor: row.unit_price_minor === null ? null : Number(row.unit_price_minor) });
    ratesByObject.set(id, rates);
  }
  const names = new Map(scopes.map((scope) => [scope.organizationId, scope.organizationName]));
  return {
    items: selected.map((row) => ({
      organizationId: row.organization_id as string,
      organizationName: names.get(row.organization_id as string) ?? "",
      objectId: row.object_id as string,
      objectName: row.object_name as string,
      clientId: row.client_id as string,
      clientName: row.client_name as string,
      address: row.address as string,
      areaSquareMeters: row.profile_area_square_meters as string | null,
      objectAreaSquareMeters: row.object_area_square_meters as string | null,
      visitsPerMonth: row.visits_per_month as number | null,
      serviceSchedule: (row.service_schedule as string | null) ?? "",
      contractTotalMinor: row.contract_total_minor === null ? null : Number(row.contract_total_minor),
      notes: (row.notes as string | null) ?? "",
      version: row.version as number,
      latestOrderId: row.latest_order_id as string | null,
      nextVisitAt: row.next_visit_at ? (row.next_visit_at as Date).toISOString() : null,
      rates: ratesByObject.get(row.object_id as string) ?? [],
    })),
    hasMore: rows.length > OBJECT_PROFILE_PAGE_SIZE,
    configuredCount: z.number().int().parse(counts[0]?.total ?? 0),
  };
}

export class ObjectServiceConflictError extends Error {
  constructor() { super("Service profile changed. Reload and try again."); }
}
export class ObjectServiceReferenceError extends Error {
  constructor() { super("Object or catalog service is unavailable."); }
}

export async function listObjectServiceProfiles(member: AuthenticatedMember): Promise<ObjectServiceProfile[]> {
  requirePermission(member, "orders.read");
  const sql = getDatabase();
  const rows = await sql`SELECT objects.id AS object_id, objects.name AS object_name, objects.client_id,
    objects.address, objects.area_square_meters::text AS object_area_square_meters,
    clients.legal_name AS client_name, profiles.area_square_meters::text AS profile_area_square_meters,
    profiles.visits_per_month, profiles.service_schedule, profiles.contract_total_minor,
    profiles.notes, coalesce(profiles.version, 0) AS version,
    (SELECT orders.id FROM orders WHERE orders.organization_id = objects.organization_id AND orders.object_id = objects.id
      ORDER BY orders.created_at DESC LIMIT 1) AS latest_order_id,
    (SELECT visits.scheduled_start_at FROM service_visits visits WHERE visits.organization_id = objects.organization_id
      AND visits.object_id = objects.id AND visits.status NOT IN ('completed', 'cancelled')
      AND visits.scheduled_start_at >= now() ORDER BY visits.scheduled_start_at LIMIT 1) AS next_visit_at
    FROM client_objects objects
    JOIN clients ON clients.organization_id = objects.organization_id AND clients.id = objects.client_id
    LEFT JOIN object_service_profiles profiles ON profiles.organization_id = objects.organization_id AND profiles.object_id = objects.id
    WHERE objects.organization_id = ${member.organizationId}
    ORDER BY clients.legal_name, objects.name, objects.id LIMIT 1000`;
  if (!rows.length) return [];
  const ids = rows.map((row) => row.object_id as string);
  const rateRows = await sql`SELECT id, object_id, catalog_item_id, name, line_kind, billing_basis,
    quantity::text, unit_price_minor FROM object_service_rates
    WHERE organization_id = ${member.organizationId} AND object_id IN ${sql(ids)}
    ORDER BY object_id, position`;
  const ratesByObject = new Map<string, ObjectServiceRate[]>();
  for (const row of rateRows) {
    const id = row.object_id as string;
    const rates = ratesByObject.get(id) ?? [];
    rates.push({ id: row.id as string, catalogItemId: row.catalog_item_id as string | null,
      name: row.name as string, lineKind: row.line_kind as "contract" | "request",
      billingBasis: row.billing_basis as "area" | "quantity" | "fixed", quantity: row.quantity as string,
      unitPriceMinor: row.unit_price_minor === null ? null : Number(row.unit_price_minor) });
    ratesByObject.set(id, rates);
  }
  return rows.map((row) => ({
    organizationId: member.organizationId, objectId: row.object_id as string,
    objectName: row.object_name as string, clientId: row.client_id as string,
    clientName: row.client_name as string, address: row.address as string,
    areaSquareMeters: row.profile_area_square_meters as string | null,
    objectAreaSquareMeters: row.object_area_square_meters as string | null,
    visitsPerMonth: row.visits_per_month as number | null,
    serviceSchedule: (row.service_schedule as string | null) ?? "",
    contractTotalMinor: row.contract_total_minor === null ? null : Number(row.contract_total_minor),
    notes: (row.notes as string | null) ?? "", version: row.version as number,
    latestOrderId: row.latest_order_id as string | null,
    nextVisitAt: row.next_visit_at ? (row.next_visit_at as Date).toISOString() : null,
    rates: ratesByObject.get(row.object_id as string) ?? [],
  }));
}

export async function saveObjectServiceProfile(member: AuthenticatedMember, input: ObjectServiceProfileInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [object] = await transaction`SELECT id FROM client_objects WHERE organization_id = ${member.organizationId} AND id = ${input.objectId} FOR UPDATE`;
    if (!object) throw new ObjectServiceReferenceError();
    const total = input.contractTotal ? parseMoneyToMinorUnits(input.contractTotal).toString() : null;
    const area = input.areaSquareMeters ? input.areaSquareMeters.replaceAll(" ", "").replace(",", ".") : null;
    let changed;
    if (input.expectedVersion === 0) {
      const created = await transaction`INSERT INTO object_service_profiles
        (organization_id, object_id, area_square_meters, visits_per_month, service_schedule, contract_total_minor, notes)
        VALUES (${member.organizationId}, ${input.objectId}, ${area}, ${input.visitsPerMonth},
          ${input.serviceSchedule || null}, ${total}, ${input.notes || null})
        ON CONFLICT DO NOTHING RETURNING version`;
      changed = created[0];
    } else {
      const updated = await transaction`UPDATE object_service_profiles SET area_square_meters = ${area},
        visits_per_month = ${input.visitsPerMonth}, service_schedule = ${input.serviceSchedule || null},
        contract_total_minor = ${total}, notes = ${input.notes || null}, version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND object_id = ${input.objectId}
          AND version = ${input.expectedVersion} RETURNING version`;
      changed = updated[0];
    }
    if (!changed) throw new ObjectServiceConflictError();
    const catalogIds = input.rates.flatMap((rate) => rate.catalogItemId ? [rate.catalogItemId] : []);
    if (catalogIds.length) {
      const available = await transaction`SELECT id FROM catalog_items WHERE organization_id = ${member.organizationId}
        AND kind = 'service' AND active AND id IN ${transaction(catalogIds)}`;
      const retained = await transaction`SELECT catalog_item_id AS id FROM object_service_rates WHERE organization_id = ${member.organizationId}
        AND object_id = ${input.objectId} AND catalog_item_id IN ${transaction(catalogIds)}`;
      const permitted = new Set([...available, ...retained].map((row) => row.id));
      if (catalogIds.some((id) => !permitted.has(id))) throw new ObjectServiceReferenceError();
    }
    await transaction`DELETE FROM object_service_rates WHERE organization_id = ${member.organizationId} AND object_id = ${input.objectId}`;
    for (const [index, rate] of input.rates.entries()) {
      const price = rate.unitPrice ? parseMoneyToMinorUnits(rate.unitPrice).toString() : null;
      const quantity = rate.billingBasis === "quantity" ? rate.quantity.replaceAll(" ", "").replace(",", ".") : null;
      await transaction`INSERT INTO object_service_rates
        (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, quantity, unit_price_minor, position)
        VALUES (${member.organizationId}, ${input.objectId}, ${rate.catalogItemId}, ${rate.name}, ${rate.lineKind},
          ${rate.billingBasis}, ${quantity}, ${price}, ${index + 1})`;
    }
  });
}

export async function getObjectServiceProfile(member: AuthenticatedMember, objectId: string) {
  requirePermission(member, "orders.read");
  const sql = getDatabase();
  const [row] = await sql`SELECT objects.id AS object_id, objects.name AS object_name, objects.client_id,
    objects.address, objects.area_square_meters::text AS object_area_square_meters,
    clients.legal_name AS client_name, profiles.area_square_meters::text AS profile_area_square_meters,
    profiles.visits_per_month, profiles.service_schedule, profiles.contract_total_minor, profiles.notes,
    coalesce(profiles.version, 0) AS version
    FROM client_objects objects
    JOIN clients ON clients.organization_id = objects.organization_id AND clients.id = objects.client_id
    LEFT JOIN object_service_profiles profiles ON profiles.organization_id = objects.organization_id AND profiles.object_id = objects.id
    WHERE objects.organization_id = ${member.organizationId} AND objects.id = ${objectId}`;
  if (!row) return null;
  const rateRows = await sql`SELECT id, catalog_item_id, name, line_kind, billing_basis, quantity::text, unit_price_minor
    FROM object_service_rates WHERE organization_id = ${member.organizationId} AND object_id = ${objectId} ORDER BY position`;
  return {
    organizationId: member.organizationId, objectId: row.object_id as string,
    objectName: row.object_name as string, clientId: row.client_id as string,
    clientName: row.client_name as string, address: row.address as string,
    areaSquareMeters: row.profile_area_square_meters as string | null,
    objectAreaSquareMeters: row.object_area_square_meters as string | null,
    visitsPerMonth: row.visits_per_month as number | null,
    serviceSchedule: (row.service_schedule as string | null) ?? "",
    contractTotalMinor: row.contract_total_minor === null ? null : Number(row.contract_total_minor),
    notes: (row.notes as string | null) ?? "", version: row.version as number,
    latestOrderId: null, nextVisitAt: null,
    rates: rateRows.map((rate) => ({ id: rate.id as string, catalogItemId: rate.catalog_item_id as string | null,
      name: rate.name as string, lineKind: rate.line_kind as "contract" | "request",
      billingBasis: rate.billing_basis as "area" | "quantity" | "fixed", quantity: rate.quantity as string,
      unitPriceMinor: rate.unit_price_minor === null ? null : Number(rate.unit_price_minor) })),
  } satisfies ObjectServiceProfile;
}
