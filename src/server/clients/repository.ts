import "server-only";
import { z } from "zod";
import type { Client } from "@/lib/mock-data";
import { CLIENT_PAGE_SIZE, type ClientListPage, type ClientListQuery } from "@/lib/client-list";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { normalizeContactPhone } from "./phone";
import type { CreateClientContactInput, CreateClientInput, CreateClientObjectInput, UpdateClientInput } from "./schemas";
import type { ClientDetail } from "./types";

const clientListRowSchema = z.object({
  id: z.string().uuid(), legal_name: z.string(), kind: z.enum(["legal_entity", "individual"]), tax_id: z.string().nullable(),
  contact_name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable(),
  object_count: z.number().int().nonnegative(), order_count: z.number().int().nonnegative(),
});
const clientDetailRowSchema = z.object({
  id: z.string().uuid(), legal_name: z.string(), kind: z.enum(["legal_entity", "individual"]),
  tax_id: z.string().nullable(), primary_phone: z.string().nullable(), primary_email: z.string().nullable(),
  version: z.number().int().positive(), created_at: z.coerce.date(), order_count: z.number().int().nonnegative(),
});
const contactRowSchema = z.object({
  id: z.string().uuid(), full_name: z.string(), position: z.string().nullable(), phone: z.string(),
  email: z.string().nullable(), is_primary: z.boolean(), created_at: z.coerce.date(),
});
const objectRowSchema = z.object({
  id: z.string().uuid(), name: z.string(), object_type: z.string(), address: z.string(),
  area_square_meters: z.coerce.number().nullable(), floor_count: z.number().int().nullable(),
  onsite_contact: z.string().nullable(), access_instructions: z.string().nullable(), parking_notes: z.string().nullable(),
  restrictions: z.string().nullable(), risk_level: z.number().int().nullable(), infestation_level: z.number().int().nullable(),
  created_at: z.coerce.date(),
});

export class ClientConflictError extends Error {
  constructor() { super("A client with this tax ID already exists."); this.name = "ClientConflictError"; }
}
export class ClientNotFoundError extends Error {
  constructor() { super("Client was not found."); this.name = "ClientNotFoundError"; }
}
export class ClientVersionConflictError extends Error {
  constructor() { super("Client was changed by another member."); this.name = "ClientVersionConflictError"; }
}
export class ClientContactConflictError extends Error {
  constructor() { super("This phone is already attached to the client."); this.name = "ClientContactConflictError"; }
}
export class ClientObjectConflictError extends Error {
  constructor() { super("An object with this address already exists for the client."); this.name = "ClientObjectConflictError"; }
}

function databaseConstraint(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

export async function listClientsPage(member: AuthenticatedMember, query: ClientListQuery): Promise<ClientListPage> {
  requirePermission(member, "clients.read");
  const sql = getDatabase();
  const kind = query.kind === "all" ? null : query.kind === "Юр. лицо" ? "legal_entity" : "individual";
  const offset = (query.page - 1) * CLIENT_PAGE_SIZE;
  const [rows, summaryRows] = await Promise.all([
    sql`
      WITH client_rows AS (
        SELECT clients.id, clients.legal_name, clients.kind, clients.tax_id,
          primary_contact.full_name AS contact_name,
          coalesce(primary_contact.phone, clients.primary_phone) AS phone,
          coalesce(primary_contact.email, clients.primary_email) AS email,
          (SELECT count(*)::int FROM client_objects objects WHERE objects.organization_id = clients.organization_id AND objects.client_id = clients.id) AS object_count,
          (SELECT count(*)::int FROM orders WHERE orders.organization_id = clients.organization_id AND orders.client_id = clients.id) AS order_count
        FROM clients
        LEFT JOIN client_contacts primary_contact ON primary_contact.organization_id = clients.organization_id
          AND primary_contact.client_id = clients.id AND primary_contact.is_primary
        WHERE clients.organization_id = ${member.organizationId}
          AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', clients.legal_name, clients.tax_id,
            clients.primary_phone, clients.primary_email, primary_contact.full_name, primary_contact.phone, primary_contact.email), ${query.q}))
          AND (${kind}::text IS NULL OR clients.kind = ${kind})
      )
      SELECT *, count(*) OVER ()::int AS total_count FROM client_rows
      WHERE (${query.history} = 'all' OR (${query.history} = 'with-orders' AND order_count > 0) OR (${query.history} = 'without-orders' AND order_count = 0))
        AND (${query.minOrders}::int IS NULL OR order_count >= ${query.minOrders})
        AND (${query.minObjects}::int IS NULL OR object_count >= ${query.minObjects})
      ORDER BY
        CASE WHEN ${query.sort} = 'orders-desc' THEN order_count END DESC NULLS LAST,
        CASE WHEN ${query.sort} = 'objects-desc' THEN object_count END DESC NULLS LAST,
        legal_name ASC, id ASC
      LIMIT ${CLIENT_PAGE_SIZE} OFFSET ${offset}
    `,
    sql`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM orders WHERE orders.organization_id = clients.organization_id AND orders.client_id = clients.id))::int AS active,
        (SELECT count(*)::int FROM client_objects WHERE organization_id = ${member.organizationId}) AS objects,
        (SELECT count(*)::int FROM orders WHERE organization_id = ${member.organizationId}) AS orders
      FROM clients WHERE organization_id = ${member.organizationId}
    `,
  ]);
  const summaryRow = z.object({ total: z.number().int(), active: z.number().int(), objects: z.number().int(), orders: z.number().int() }).parse(summaryRows[0]);
  const summary = { ...summaryRow, withoutOrders: summaryRow.total - summaryRow.active };
  if (!rows.length && query.page > 1) return listClientsPage(member, { ...query, page: 1 });
  const items: Client[] = rows.map((row) => {
    const parsed = clientListRowSchema.parse(row);
    return { id: parsed.id, name: parsed.legal_name, kind: parsed.kind === "legal_entity" ? "Юр. лицо" : "Физ. лицо", taxId: parsed.tax_id, phone: parsed.phone ?? "Не указан", email: parsed.email ?? "Не указан", objects: parsed.object_count, orders: parsed.order_count, contact: parsed.contact_name ?? "Не указан" };
  });
  const total = rows.length ? z.number().int().parse(rows[0].total_count) : 0;
  return { items, total, page: query.page, pageSize: CLIENT_PAGE_SIZE, summary };
}

export async function getClientDetail(member: AuthenticatedMember, clientId: string): Promise<ClientDetail> {
  requirePermission(member, "clients.read");
  const sql = getDatabase();
  const [clientRows, contactRows, objectRows] = await Promise.all([
    sql`SELECT clients.id, clients.legal_name, clients.kind, clients.tax_id, clients.primary_phone,
      clients.primary_email, clients.version, clients.created_at, count(orders.id)::int AS order_count
      FROM clients LEFT JOIN orders ON orders.organization_id = clients.organization_id AND orders.client_id = clients.id
      WHERE clients.organization_id = ${member.organizationId} AND clients.id = ${clientId}
      GROUP BY clients.id`,
    sql`SELECT id, full_name, position, phone, email, is_primary, created_at FROM client_contacts
      WHERE organization_id = ${member.organizationId} AND client_id = ${clientId}
      ORDER BY is_primary DESC, created_at ASC`,
    sql`SELECT id, name, object_type, address, area_square_meters, floor_count, onsite_contact,
      access_instructions, parking_notes, restrictions, risk_level, infestation_level, created_at
      FROM client_objects WHERE organization_id = ${member.organizationId} AND client_id = ${clientId}
      ORDER BY created_at DESC`,
  ]);
  if (!clientRows.length) throw new ClientNotFoundError();
  const client = clientDetailRowSchema.parse(clientRows[0]);
  return {
    id: client.id, legalName: client.legal_name, kind: client.kind, taxId: client.tax_id,
    primaryPhone: client.primary_phone, primaryEmail: client.primary_email, version: client.version,
    createdAt: client.created_at.toISOString(), orderCount: client.order_count,
    contacts: contactRows.map((row) => { const contact = contactRowSchema.parse(row); return { id: contact.id, fullName: contact.full_name, position: contact.position, phone: contact.phone, email: contact.email, isPrimary: contact.is_primary, createdAt: contact.created_at.toISOString() }; }),
    objects: objectRows.map((row) => { const object = objectRowSchema.parse(row); return { id: object.id, name: object.name, objectType: object.object_type, address: object.address, areaSquareMeters: object.area_square_meters, floorCount: object.floor_count, onsiteContact: object.onsite_contact, accessInstructions: object.access_instructions, parkingNotes: object.parking_notes, restrictions: object.restrictions, riskLevel: object.risk_level, infestationLevel: object.infestation_level, createdAt: object.created_at.toISOString() }; }),
  };
}

export async function createClient(member: AuthenticatedMember, input: CreateClientInput) {
  requirePermission(member, "clients.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`
        INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'clients.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key
      `;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "clients.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [client] = await transaction`
        INSERT INTO clients (organization_id, legal_name, kind, tax_id, primary_phone, primary_email)
        VALUES (${member.organizationId}, ${input.legalName}, ${input.kind}, ${input.taxId}, ${input.phone}, ${input.email}) RETURNING id
      `;
      await transaction`
        INSERT INTO client_contacts (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
        VALUES (${member.organizationId}, ${client.id}, ${input.contactName}, ${input.contactPosition}, ${input.phone}, ${normalizeContactPhone(input.phone)}, ${input.email}, true)
      `;
      await transaction`UPDATE idempotency_requests SET entity_id = ${client.id} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client.create', 'client', ${client.id}, ${transaction.json({ legalName: input.legalName, kind: input.kind })})`;
      return z.string().uuid().parse(client.id);
    });
  } catch (error) {
    if (databaseConstraint(error) === "clients_organization_tax_id_unique_idx") throw new ClientConflictError();
    throw error;
  }
}

export async function updateClient(member: AuthenticatedMember, input: UpdateClientInput) {
  requirePermission(member, "clients.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [updated] = await transaction`
        UPDATE clients SET legal_name = ${input.legalName}, kind = ${input.kind}, tax_id = ${input.taxId},
          version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.clientId} AND version = ${input.expectedVersion}
        RETURNING version
      `;
      if (!updated) {
        const [existing] = await transaction`SELECT id FROM clients WHERE organization_id = ${member.organizationId} AND id = ${input.clientId}`;
        if (!existing) throw new ClientNotFoundError();
        throw new ClientVersionConflictError();
      }
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client.update', 'client', ${input.clientId}, ${transaction.json({ legalName: input.legalName, kind: input.kind, taxId: input.taxId, version: updated.version })})`;
      return z.number().int().positive().parse(updated.version);
    });
  } catch (error) {
    if (databaseConstraint(error) === "clients_organization_tax_id_unique_idx") throw new ClientConflictError();
    throw error;
  }
}

export async function createClientContact(member: AuthenticatedMember, input: CreateClientContactInput) {
  requirePermission(member, "clients.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'client_contacts.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "client_contacts.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [client] = await transaction`SELECT id FROM clients WHERE organization_id = ${member.organizationId} AND id = ${input.clientId} FOR UPDATE`;
      if (!client) throw new ClientNotFoundError();
      if (input.isPrimary) await transaction`UPDATE client_contacts SET is_primary = false, updated_at = now() WHERE organization_id = ${member.organizationId} AND client_id = ${input.clientId} AND is_primary`;
      const [contact] = await transaction`INSERT INTO client_contacts
        (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
        VALUES (${member.organizationId}, ${input.clientId}, ${input.fullName}, ${input.position}, ${input.phone}, ${normalizeContactPhone(input.phone)}, ${input.email}, ${input.isPrimary}) RETURNING id`;
      if (input.isPrimary) await transaction`UPDATE clients SET primary_phone = ${input.phone}, primary_email = ${input.email}, version = version + 1, updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${input.clientId}`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${contact.id} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client_contact.create', 'client_contact', ${contact.id}, ${transaction.json({ clientId: input.clientId, isPrimary: input.isPrimary })})`;
      return z.string().uuid().parse(contact.id);
    });
  } catch (error) {
    if (databaseConstraint(error) === "client_contacts_client_phone_unique_idx") throw new ClientContactConflictError();
    throw error;
  }
}

export async function createClientObject(member: AuthenticatedMember, input: CreateClientObjectInput) {
  requirePermission(member, "clients.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'client_objects.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "client_objects.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      const [client] = await transaction`SELECT id FROM clients WHERE organization_id = ${member.organizationId} AND id = ${input.clientId}`;
      if (!client) throw new ClientNotFoundError();
      const [object] = await transaction`INSERT INTO client_objects
        (organization_id, client_id, name, object_type, address, area_square_meters, floor_count, onsite_contact,
          access_instructions, parking_notes, restrictions, risk_level, infestation_level)
        VALUES (${member.organizationId}, ${input.clientId}, ${input.name}, ${input.objectType}, ${input.address}, ${input.areaSquareMeters}, ${input.floorCount}, ${input.onsiteContact}, ${input.accessInstructions}, ${input.parkingNotes}, ${input.restrictions}, ${input.riskLevel}, ${input.infestationLevel}) RETURNING id`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${object.id} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client_object.create', 'client_object', ${object.id}, ${transaction.json({ clientId: input.clientId, name: input.name, address: input.address })})`;
      return z.string().uuid().parse(object.id);
    });
  } catch (error) {
    if (databaseConstraint(error) === "client_objects_client_address_unique_idx") throw new ClientObjectConflictError();
    throw error;
  }
}
