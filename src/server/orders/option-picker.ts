import "server-only";
import { z } from "zod";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerQuery, type OrderPickerResult } from "@/lib/order-picker";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

const itemRow = z.object({ id: z.string().uuid(), name: z.string(), detail: z.string().nullable(), client_id: z.string().uuid().nullable(), is_primary: z.boolean().nullable() });

export async function searchOrderPicker(member: AuthenticatedMember, query: OrderPickerQuery): Promise<OrderPickerResult> {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  const limit = ORDER_PICKER_PAGE_SIZE + 1;
  const scopedClientId = query.clientId ?? null;
  let rows;
  if (query.type === "clients") {
    rows = await sql`
      SELECT id, legal_name AS name, tax_id AS detail, NULL::uuid AS client_id, NULL::boolean AS is_primary
      FROM clients WHERE organization_id = ${member.organizationId}
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', legal_name, tax_id, primary_phone, primary_email), ${query.q}))
      ORDER BY legal_name, id LIMIT ${limit}
    `;
  } else if (query.type === "objects") {
    rows = await sql`
      SELECT id, name, address AS detail, client_id, NULL::boolean AS is_primary
      FROM client_objects WHERE organization_id = ${member.organizationId} AND client_id = ${scopedClientId}
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', name, address), ${query.q}))
      ORDER BY name, id LIMIT ${limit}
    `;
  } else if (query.type === "contacts") {
    rows = await sql`
      SELECT id, full_name AS name, phone AS detail, client_id, is_primary
      FROM client_contacts WHERE organization_id = ${member.organizationId} AND client_id = ${scopedClientId}
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', full_name, phone, email), ${query.q}))
      ORDER BY is_primary DESC, full_name, id LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT id, full_name AS name, phone AS detail, NULL::uuid AS client_id, NULL::boolean AS is_primary
      FROM masters WHERE organization_id = ${member.organizationId} AND active AND operational_status = 'working'
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', full_name, phone), ${query.q}))
      ORDER BY full_name, id LIMIT ${limit}
    `;
  }
  return {
    items: rows.slice(0, ORDER_PICKER_PAGE_SIZE).map((row) => {
      const item = itemRow.parse(row);
      return { id: item.id, name: item.name, ...(item.detail ? { detail: item.detail } : {}),
        ...(item.client_id ? { clientId: item.client_id } : {}), ...(item.is_primary !== null ? { isPrimary: item.is_primary } : {}) };
    }),
    hasMore: rows.length > ORDER_PICKER_PAGE_SIZE,
  };
}
