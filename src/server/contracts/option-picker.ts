import "server-only";
import { z } from "zod";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerResult } from "@/lib/order-picker";
import { readableOrganizationIds } from "@/server/organizations/read-scope";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const contractPickerQuerySchema = z.object({
  type: z.enum(["objects", "masters", "contracts", "filter-masters"]),
  q: z.string().trim().max(100).default(""),
  sourceContractId: z.string().uuid().optional(),
});

export type ContractPickerQuery = z.infer<typeof contractPickerQuerySchema>;

const itemRow = z.object({
  id: z.string().uuid(),
  name: z.string(),
  detail: z.string().nullable(),
  client_id: z.string().uuid().nullable(),
});

export async function searchContractPicker(member: AuthenticatedMember, query: ContractPickerQuery): Promise<OrderPickerResult> {
  requirePermission(member, query.type === "filter-masters" ? "contracts.read" : "contracts.write");
  const sql = getDatabase();
  const limit = ORDER_PICKER_PAGE_SIZE + 1;
  let rows;
  if (query.type === "filter-masters") {
    const organizationIds = await readableOrganizationIds(member);
    rows = await sql`SELECT masters.id, masters.full_name AS name, organizations.name AS detail, NULL::uuid AS client_id
      FROM masters JOIN organizations ON organizations.id = masters.organization_id
      WHERE masters.organization_id IN ${sql(organizationIds)}
        AND EXISTS (SELECT 1 FROM contract_schedule_rules rules WHERE rules.organization_id = masters.organization_id AND rules.default_master_id = masters.id)
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', masters.full_name, masters.phone, organizations.name), ${query.q}))
      ORDER BY masters.full_name, masters.id LIMIT ${limit}`;
  } else if (query.type === "objects") {
    rows = await sql`SELECT client_objects.id,
        concat(clients.legal_name, ' · ', client_objects.name) AS name,
        client_objects.address AS detail, client_objects.client_id
      FROM client_objects
      JOIN clients ON clients.organization_id = client_objects.organization_id AND clients.id = client_objects.client_id
      WHERE client_objects.organization_id = ${member.organizationId}
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', clients.legal_name, client_objects.name, client_objects.address), ${query.q}))
      ORDER BY clients.legal_name, client_objects.name, client_objects.id LIMIT ${limit}`;
  } else if (query.type === "masters") {
    rows = await sql`SELECT id, full_name AS name, service_region AS detail, NULL::uuid AS client_id
      FROM masters WHERE organization_id = ${member.organizationId} AND active AND operational_status = 'working'
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', full_name, phone, service_region), ${query.q}))
      ORDER BY full_name, id LIMIT ${limit}`;
  } else {
    const sourceContractId = query.sourceContractId ?? null;
    rows = await sql`SELECT contracts.id,
        contracts.contract_number AS name, clients.legal_name AS detail, NULL::uuid AS client_id
      FROM contracts
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      WHERE contracts.organization_id = ${member.organizationId}
        AND (${sourceContractId}::uuid IS NULL OR (
          contracts.id <> ${sourceContractId}::uuid
          AND NOT EXISTS (SELECT 1 FROM contract_relations relation
            WHERE relation.organization_id = contracts.organization_id
              AND ((relation.contract_a_id = contracts.id AND relation.contract_b_id = ${sourceContractId}::uuid)
                OR (relation.contract_b_id = contracts.id AND relation.contract_a_id = ${sourceContractId}::uuid)))))
        AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', contracts.contract_number, clients.legal_name), ${query.q}))
      ORDER BY contracts.contract_number, contracts.id LIMIT ${limit}`;
  }
  return {
    items: rows.slice(0, ORDER_PICKER_PAGE_SIZE).map((row) => {
      const item = itemRow.parse(row);
      return { id: item.id, name: item.name, ...(item.detail ? { detail: item.detail } : {}),
        ...(item.client_id ? { clientId: item.client_id } : {}) };
    }),
    hasMore: rows.length > ORDER_PICKER_PAGE_SIZE,
  };
}
