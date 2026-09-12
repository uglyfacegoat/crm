import "server-only";
import { z } from "zod";
import { escapeSearchPattern, getSearchDigits, globalSearchResultSchema, parseSearchDate, type GlobalSearchResult } from "@/lib/global-search";
import { normalizeSearchText } from "@/lib/search-normalization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

const searchRowSchema = z.object({
  id: z.string().uuid(),
  entity_type: z.enum(["order", "client", "object", "visit", "document", "master", "contract"]),
  title: z.string(),
  subtitle: z.string(),
  detail: z.string().nullable(),
  href: z.string(),
  matched_by: z.string(),
  score: z.coerce.number(),
});

type RankedSearchResult = GlobalSearchResult & { score: number };

function mapRows(rows: readonly unknown[]): RankedSearchResult[] {
  return rows.map((row) => {
    const parsed = searchRowSchema.parse(row);
    return {
      ...globalSearchResultSchema.parse({
        id: parsed.id,
        entityType: parsed.entity_type,
        title: parsed.title,
        subtitle: parsed.subtitle,
        detail: parsed.detail,
        href: parsed.href,
        matchedBy: parsed.matched_by,
      }),
      score: parsed.score,
    };
  });
}

export async function searchGlobal(member: AuthenticatedMember, query: string): Promise<GlobalSearchResult[]> {
  requirePermission(member, "search.use");

  const sql = getDatabase();
  const normalized = normalizeSearchText(query);
  const escaped = escapeSearchPattern(normalized);
  const containsPattern = `%${escaped}%`;
  const prefixPattern = `${escaped}%`;
  const searchDate = parseSearchDate(query);
  const searchDigits = getSearchDigits(query);
  const phonePattern = searchDigits ? `%${searchDigits}%` : null;
  const searches: PromiseLike<readonly unknown[]>[] = [];

  if (hasPermission(member, "clients.read")) {
    searches.push(sql`
      SELECT clients.id, 'client' AS entity_type, clients.legal_name AS title,
        coalesce(nullif(concat_ws(' · ', CASE WHEN clients.tax_id IS NOT NULL THEN 'ИНН ' || clients.tax_id END, clients.primary_phone), ''), 'Карточка клиента') AS subtitle,
        clients.primary_email AS detail, '/clients/' || clients.id::text AS href,
        CASE
          WHEN lower(clients.legal_name) LIKE ${containsPattern} ESCAPE '\' THEN 'Название клиента'
          WHEN lower(coalesce(clients.tax_id, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'ИНН'
          WHEN lower(coalesce(clients.primary_phone, '')) LIKE ${containsPattern} ESCAPE '\'
            OR (${phonePattern}::text IS NOT NULL AND regexp_replace(coalesce(clients.primary_phone, ''), '\D', '', 'g') LIKE ${phonePattern}) THEN 'Телефон'
          WHEN lower(coalesce(clients.primary_email, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Email'
          ELSE 'Контакт клиента'
        END AS matched_by,
        CASE
          WHEN lower(clients.legal_name) = ${normalized} THEN 100
          WHEN lower(clients.legal_name) LIKE ${prefixPattern} ESCAPE '\' THEN 90
          WHEN lower(coalesce(clients.tax_id, '')) = ${normalized} THEN 85
          ELSE 65
        END AS score
      FROM clients
      WHERE clients.organization_id = ${member.organizationId}
        AND (
          crm_search_matches(concat_ws(' ', clients.legal_name, clients.tax_id, clients.primary_phone, clients.primary_email), ${query})
          OR (${phonePattern}::text IS NOT NULL AND regexp_replace(coalesce(clients.primary_phone, ''), '\D', '', 'g') LIKE ${phonePattern})
          OR EXISTS (
            SELECT 1 FROM client_contacts
            WHERE client_contacts.organization_id = clients.organization_id AND client_contacts.client_id = clients.id
              AND (
                crm_search_matches(concat_ws(' ', client_contacts.full_name, client_contacts.phone, client_contacts.email), ${query})
                OR (${phonePattern}::text IS NOT NULL AND regexp_replace(client_contacts.phone, '\D', '', 'g') LIKE ${phonePattern})
              )
          )
        )
      ORDER BY score DESC, clients.legal_name
      LIMIT 5
    `);

    searches.push(sql`
      SELECT client_objects.id, 'object' AS entity_type, client_objects.name AS title,
        clients.legal_name AS subtitle, client_objects.address AS detail,
        '/clients/' || clients.id::text AS href,
        CASE
          WHEN lower(client_objects.address) LIKE ${containsPattern} ESCAPE '\' THEN 'Адрес объекта'
          WHEN lower(coalesce(client_objects.onsite_contact, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Контакт на объекте'
          ELSE 'Название объекта'
        END AS matched_by,
        CASE
          WHEN lower(client_objects.name) = ${normalized} THEN 98
          WHEN lower(client_objects.name) LIKE ${prefixPattern} ESCAPE '\' THEN 88
          WHEN lower(client_objects.address) LIKE ${prefixPattern} ESCAPE '\' THEN 82
          ELSE 62
        END AS score
      FROM client_objects
      JOIN clients ON clients.organization_id = client_objects.organization_id AND clients.id = client_objects.client_id
      WHERE client_objects.organization_id = ${member.organizationId}
        AND crm_search_matches(concat_ws(' ', client_objects.name, client_objects.address, client_objects.onsite_contact), ${query})
      ORDER BY score DESC, client_objects.name
      LIMIT 5
    `);
  }

  if (hasPermission(member, "orders.read")) {
    searches.push(sql`
      SELECT orders.id, 'order' AS entity_type, 'Заказ №' || orders.order_number AS title,
        orders.client_name_snapshot AS subtitle, orders.object_address_snapshot AS detail,
        '/orders/' || orders.id::text AS href,
        CASE
          WHEN lower(orders.order_number) LIKE ${containsPattern} ESCAPE '\' THEN 'Номер заказа'
          WHEN lower(orders.object_address_snapshot) LIKE ${containsPattern} ESCAPE '\' THEN 'Адрес объекта'
          WHEN lower(coalesce(orders.contact_phone_snapshot, '')) LIKE ${containsPattern} ESCAPE '\'
            OR (${phonePattern}::text IS NOT NULL AND regexp_replace(coalesce(orders.contact_phone_snapshot, ''), '\D', '', 'g') LIKE ${phonePattern}) THEN 'Телефон контакта'
          WHEN lower(coalesce(orders.master_name_snapshot, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Мастер'
          ELSE 'Клиент или объект'
        END AS matched_by,
        CASE
          WHEN lower(orders.order_number) = ${normalized} OR lower('№' || orders.order_number) = ${normalized} THEN 110
          WHEN lower(orders.order_number) LIKE ${prefixPattern} ESCAPE '\' THEN 95
          WHEN lower(orders.client_name_snapshot) LIKE ${prefixPattern} ESCAPE '\' THEN 86
          ELSE 68
        END AS score
      FROM orders
      WHERE orders.organization_id = ${member.organizationId}
        AND (
          crm_search_matches(concat_ws(' ', orders.order_number, orders.client_name_snapshot, orders.object_name_snapshot, orders.object_address_snapshot, orders.contact_name_snapshot, orders.contact_phone_snapshot, orders.master_name_snapshot), ${query})
          OR (${phonePattern}::text IS NOT NULL AND regexp_replace(coalesce(orders.contact_phone_snapshot, ''), '\D', '', 'g') LIKE ${phonePattern})
        )
      ORDER BY score DESC, orders.created_at DESC
      LIMIT 5
    `);
  }

  if (hasPermission(member, "contracts.read")) {
    searches.push(sql`
      SELECT contracts.id, 'contract' AS entity_type, 'Договор ' || contracts.contract_number AS title,
        clients.legal_name || ' · ' || client_objects.name AS subtitle, client_objects.address AS detail,
        '/contracts' AS href,
        CASE
          WHEN lower(contracts.contract_number) LIKE ${containsPattern} ESCAPE '\' THEN 'Номер договора'
          WHEN lower(client_objects.address) LIKE ${containsPattern} ESCAPE '\' THEN 'Адрес объекта'
          WHEN lower(coalesce(contracts.notes, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Условия договора'
          ELSE 'Клиент или объект'
        END AS matched_by,
        CASE
          WHEN lower(contracts.contract_number) = ${normalized} THEN 108
          WHEN lower(contracts.contract_number) LIKE ${prefixPattern} ESCAPE '\' THEN 94
          WHEN lower(clients.legal_name) LIKE ${prefixPattern} ESCAPE '\' THEN 84
          ELSE 66
        END AS score
      FROM contracts
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
      WHERE contracts.organization_id = ${member.organizationId}
        AND crm_search_matches(concat_ws(' ', contracts.contract_number, clients.legal_name, client_objects.name, client_objects.address, contracts.notes), ${query})
      ORDER BY score DESC, contracts.updated_at DESC
      LIMIT 5
    `);
  }

  if (hasPermission(member, "documents.read")) {
    searches.push(sql`
      SELECT documents.id, 'document' AS entity_type, documents.title AS title,
        clients.legal_name || ' · заказ №' || orders.order_number AS subtitle,
        document_versions.original_filename AS detail,
        '/documents?client=' || documents.client_id::text || '&object=' || documents.object_id::text || '&order=' || documents.order_id::text || '&document=' || documents.id::text AS href,
        CASE
          WHEN lower(document_versions.original_filename) LIKE ${containsPattern} ESCAPE '\' THEN 'Имя файла'
          WHEN lower(coalesce(documents.description, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Описание'
          ELSE 'Название документа'
        END AS matched_by,
        CASE
          WHEN lower(documents.title) = ${normalized} THEN 96
          WHEN lower(documents.title) LIKE ${prefixPattern} ESCAPE '\' THEN 86
          WHEN lower(document_versions.original_filename) LIKE ${prefixPattern} ESCAPE '\' THEN 80
          ELSE 60
        END AS score
      FROM documents
      JOIN document_versions ON document_versions.organization_id = documents.organization_id AND document_versions.id = documents.current_version_id
      JOIN clients ON clients.organization_id = documents.organization_id AND clients.id = documents.client_id
      JOIN orders ON orders.organization_id = documents.organization_id AND orders.id = documents.order_id
      WHERE documents.organization_id = ${member.organizationId} AND documents.archived_at IS NULL
        AND crm_search_matches(concat_ws(' ', documents.title, documents.description, document_versions.original_filename), ${query})
      ORDER BY score DESC, documents.updated_at DESC
      LIMIT 5
    `);
  }

  if (hasPermission(member, "masters.read")) {
    searches.push(sql`
      SELECT masters.id, 'master' AS entity_type, masters.full_name AS title,
        concat_ws(' · ', masters.phone, masters.messenger) AS subtitle,
        masters.service_region || ' · ' || masters.service_zone AS detail,
        '/masters?master=' || masters.id::text AS href,
        CASE
          WHEN lower(masters.normalized_phone) LIKE ${containsPattern} ESCAPE '\' OR lower(masters.phone) LIKE ${containsPattern} ESCAPE '\'
            OR (${phonePattern}::text IS NOT NULL AND regexp_replace(masters.normalized_phone, '\D', '', 'g') LIKE ${phonePattern}) THEN 'Телефон'
          WHEN lower(coalesce(masters.messenger, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Мессенджер'
          WHEN lower(masters.service_region || ' ' || masters.service_zone) LIKE ${containsPattern} ESCAPE '\' THEN 'Регион или зона'
          ELSE 'ФИО мастера'
        END AS matched_by,
        CASE
          WHEN lower(masters.full_name) = ${normalized} THEN 98
          WHEN lower(masters.full_name) LIKE ${prefixPattern} ESCAPE '\' THEN 88
          ELSE 64
        END AS score
      FROM masters
      WHERE masters.organization_id = ${member.organizationId}
        AND (
          crm_search_matches(concat_ws(' ', masters.full_name, masters.phone, masters.normalized_phone, masters.messenger, masters.service_region, masters.service_zone), ${query})
          OR (${phonePattern}::text IS NOT NULL AND regexp_replace(masters.normalized_phone, '\D', '', 'g') LIKE ${phonePattern})
        )
      ORDER BY score DESC, masters.active DESC, masters.full_name
      LIMIT 5
    `);
  }

  if (hasPermission(member, "visits.read")) {
    searches.push(sql`
      SELECT service_visits.id, 'visit' AS entity_type,
        'Выезд · ' || service_visits.client_name_snapshot AS title,
        to_char(service_visits.scheduled_start_at AT TIME ZONE organizations.timezone, 'DD.MM.YYYY HH24:MI') AS subtitle,
        service_visits.object_address_snapshot || CASE WHEN service_visits.master_name_snapshot IS NOT NULL THEN ' · ' || service_visits.master_name_snapshot ELSE '' END AS detail,
        CASE WHEN service_visits.order_id IS NOT NULL THEN '/orders/' || service_visits.order_id::text ELSE '/calendar?date=' || to_char(service_visits.scheduled_start_at AT TIME ZONE organizations.timezone, 'YYYY-MM-DD') END AS href,
        CASE
          WHEN ${searchDate}::date IS NOT NULL THEN 'Дата выезда'
          WHEN lower(coalesce(orders.order_number, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Номер заказа'
          WHEN lower(service_visits.object_address_snapshot) LIKE ${containsPattern} ESCAPE '\' THEN 'Адрес объекта'
          WHEN lower(coalesce(service_visits.master_name_snapshot, '')) LIKE ${containsPattern} ESCAPE '\' THEN 'Мастер'
          ELSE 'Клиент или объект'
        END AS matched_by,
        CASE
          WHEN ${searchDate}::date IS NOT NULL THEN 105
          WHEN lower(coalesce(orders.order_number, '')) = ${normalized} THEN 90
          WHEN lower(service_visits.client_name_snapshot) LIKE ${prefixPattern} ESCAPE '\' THEN 82
          ELSE 58
        END AS score
      FROM service_visits
      JOIN organizations ON organizations.id = service_visits.organization_id
      LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
      WHERE service_visits.organization_id = ${member.organizationId}
        AND (
          (${searchDate}::date IS NOT NULL
            AND service_visits.scheduled_start_at >= (${searchDate}::date::timestamp AT TIME ZONE organizations.timezone)
            AND service_visits.scheduled_start_at < ((${searchDate}::date + 1)::timestamp AT TIME ZONE organizations.timezone))
          OR crm_search_matches(concat_ws(' ', service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot, service_visits.master_name_snapshot, orders.order_number), ${query})
        )
      ORDER BY score DESC, service_visits.scheduled_start_at DESC
      LIMIT 5
    `);
  }

  const groups = await Promise.all(searches);
  return groups
    .flatMap(mapRows)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ru"))
    .slice(0, 18)
    .map((result) => ({
      id: result.id,
      entityType: result.entityType,
      title: result.title,
      subtitle: result.subtitle,
      detail: result.detail,
      href: result.href,
      matchedBy: result.matchedBy,
    }));
}
