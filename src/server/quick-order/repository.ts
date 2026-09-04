import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import {
  calculateServiceLineTotalMinor,
  formatQuantityForDatabase,
  parseMoneyToMinorUnits,
  parseQuantityToMilliunits,
} from "@/server/orders/money";
import type { QuickOrderInput } from "./schemas";
import type { QuickOrderResult } from "./types";

const uuidSchema = z.string().uuid();
const orderNumberSchema = z.string().min(2);
const timestampRangeSchema = z.object({ start_at: z.coerce.date(), end_at: z.coerce.date() });
const existingResultSchema = z.object({
  client_id: uuidSchema,
  object_id: uuidSchema,
  client_contact_id: uuidSchema,
  order_id: uuidSchema,
  order_number: orderNumberSchema,
  visit_id: uuidSchema,
});

export class QuickOrderReferenceError extends Error {
  constructor(readonly field: "client" | "contact" | "object" | "master") {
    super(`The selected ${field} is unavailable.`);
    this.name = "QuickOrderReferenceError";
  }
}

export class QuickOrderConflictError extends Error {
  constructor(readonly field: "client" | "contact" | "object") {
    super(`The ${field} conflicts with an existing record.`);
    this.name = "QuickOrderConflictError";
  }
}

export class QuickOrderScheduleConflictError extends Error {
  constructor() {
    super("The selected master already has another visit at this time.");
    this.name = "QuickOrderScheduleConflictError";
  }
}

export class QuickOrderLeadConflictError extends Error {
  constructor() {
    super("The incoming lead was changed or already processed.");
    this.name = "QuickOrderLeadConflictError";
  }
}

function databaseConstraint(error: unknown, expectedCode?: string) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; constraint_name?: unknown };
  if (expectedCode && candidate.code !== expectedCode) return null;
  return typeof candidate.constraint_name === "string" ? candidate.constraint_name : null;
}

function mapExistingResult(row: unknown): QuickOrderResult {
  const result = existingResultSchema.parse(row);
  return {
    clientId: result.client_id,
    objectId: result.object_id,
    contactId: result.client_contact_id,
    orderId: result.order_id,
    orderNumber: result.order_number,
    visitId: result.visit_id,
  };
}

export async function createQuickOrder(member: AuthenticatedMember, input: QuickOrderInput): Promise<QuickOrderResult> {
  requirePermission(member, "clients.write");
  requirePermission(member, "orders.write");
  requirePermission(member, "visits.write");
  if (input.sourceLead) requirePermission(member, "leads.write");
  const sql = getDatabase();

  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`
        INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'quick_orders.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        RETURNING idempotency_key
      `;
      if (!insertedRequest.length) {
        const [existingRequest] = await transaction`
          SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}
        `;
        if (existingRequest?.operation !== "quick_orders.create" || !existingRequest.entity_id) {
          throw new Error("Idempotency key is already used by another operation.");
        }
        const [existingResult] = await transaction`
          SELECT orders.client_id, orders.object_id, orders.client_contact_id, orders.id AS order_id,
            orders.order_number, service_visits.id AS visit_id
          FROM orders
          JOIN service_visits ON service_visits.organization_id = orders.organization_id
            AND service_visits.order_id = orders.id
          WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${existingRequest.entity_id}
          ORDER BY service_visits.created_at ASC, service_visits.id ASC
          LIMIT 1
        `;
        if (!existingResult) throw new Error("Idempotent quick order result is incomplete.");
        return mapExistingResult(existingResult);
      }

      if (input.sourceLead) {
        const [lead] = await transaction`SELECT moderation_status, version FROM website_leads
          WHERE organization_id = ${member.organizationId} AND id = ${input.sourceLead.id} FOR UPDATE`;
        if (!lead || !["new", "reviewing"].includes(z.string().parse(lead.moderation_status))
          || z.number().int().parse(lead.version) !== input.sourceLead.expectedVersion) {
          throw new QuickOrderLeadConflictError();
        }
      }

      let clientId: string;
      let clientName: string;
      let contactId: string;
      let contactName: string;
      let contactPhone: string;
      let objectId: string;
      let objectName: string;
      let objectAddress: string;

      if (input.client.mode === "new") {
        const details = input.client.details;
        const [client] = await transaction`
          INSERT INTO clients (organization_id, legal_name, kind, tax_id, primary_phone, primary_email)
          VALUES (${member.organizationId}, ${details.legalName}, ${details.kind}, ${details.taxId}, ${details.phone}, ${details.email})
          RETURNING id, legal_name
        `;
        clientId = uuidSchema.parse(client.id);
        clientName = z.string().parse(client.legal_name);

        const [contact] = await transaction`
          INSERT INTO client_contacts (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
          VALUES (${member.organizationId}, ${clientId}, ${details.contactName}, ${details.contactPosition}, ${details.phone},
            ${normalizeContactPhone(details.phone)}, ${details.email}, true)
          RETURNING id, full_name, phone
        `;
        contactId = uuidSchema.parse(contact.id);
        contactName = z.string().parse(contact.full_name);
        contactPhone = z.string().parse(contact.phone);

        const objectDetails = input.client.object;
        const [clientObject] = await transaction`
          INSERT INTO client_objects (
            organization_id, client_id, name, object_type, address, area_square_meters, floor_count,
            onsite_contact, access_instructions, parking_notes, restrictions, risk_level, infestation_level
          ) VALUES (
            ${member.organizationId}, ${clientId}, ${objectDetails.name}, ${objectDetails.objectType}, ${objectDetails.address},
            ${objectDetails.areaSquareMeters}, ${objectDetails.floorCount}, ${objectDetails.onsiteContact},
            ${objectDetails.accessInstructions}, ${objectDetails.parkingNotes}, ${objectDetails.restrictions},
            ${objectDetails.riskLevel}, ${objectDetails.infestationLevel}
          ) RETURNING id, name, address
        `;
        objectId = uuidSchema.parse(clientObject.id);
        objectName = z.string().parse(clientObject.name);
        objectAddress = z.string().parse(clientObject.address);

        await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
          VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client.create', 'client', ${clientId},
            ${transaction.json({ source: "quick_order", legalName: details.legalName, kind: details.kind })})`;
        await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
          VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client_object.create', 'client_object', ${objectId},
            ${transaction.json({ source: "quick_order", clientId, name: objectName, address: objectAddress })})`;
      } else {
        clientId = input.client.clientId;
        const [client] = await transaction`
          SELECT id, legal_name FROM clients
          WHERE organization_id = ${member.organizationId} AND id = ${clientId}
        `;
        if (!client) throw new QuickOrderReferenceError("client");
        clientName = z.string().parse(client.legal_name);

        if (input.client.contact.mode === "existing") {
          contactId = input.client.contact.contactId;
          const [contact] = await transaction`
            SELECT id, full_name, phone FROM client_contacts
            WHERE organization_id = ${member.organizationId} AND client_id = ${clientId} AND id = ${contactId}
          `;
          if (!contact) throw new QuickOrderReferenceError("contact");
          contactName = z.string().parse(contact.full_name);
          contactPhone = z.string().parse(contact.phone);
        } else {
          const contactDetails = input.client.contact.details;
          const [contact] = await transaction`
            INSERT INTO client_contacts (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
            VALUES (${member.organizationId}, ${clientId}, ${contactDetails.fullName}, ${contactDetails.position}, ${contactDetails.phone},
              ${normalizeContactPhone(contactDetails.phone)}, ${contactDetails.email}, false)
            RETURNING id, full_name, phone
          `;
          contactId = uuidSchema.parse(contact.id);
          contactName = z.string().parse(contact.full_name);
          contactPhone = z.string().parse(contact.phone);
          await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
            VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client_contact.create', 'client_contact', ${contactId},
              ${transaction.json({ source: "quick_order", clientId, isPrimary: false })})`;
        }

        if (input.client.object.mode === "existing") {
          objectId = input.client.object.objectId;
          const [clientObject] = await transaction`
            SELECT id, name, address FROM client_objects
            WHERE organization_id = ${member.organizationId} AND client_id = ${clientId} AND id = ${objectId}
          `;
          if (!clientObject) throw new QuickOrderReferenceError("object");
          objectName = z.string().parse(clientObject.name);
          objectAddress = z.string().parse(clientObject.address);
        } else {
          const objectDetails = input.client.object.details;
          const [clientObject] = await transaction`
            INSERT INTO client_objects (
              organization_id, client_id, name, object_type, address, area_square_meters, floor_count,
              onsite_contact, access_instructions, parking_notes, restrictions, risk_level, infestation_level
            ) VALUES (
              ${member.organizationId}, ${clientId}, ${objectDetails.name}, ${objectDetails.objectType}, ${objectDetails.address},
              ${objectDetails.areaSquareMeters}, ${objectDetails.floorCount}, ${objectDetails.onsiteContact},
              ${objectDetails.accessInstructions}, ${objectDetails.parkingNotes}, ${objectDetails.restrictions},
              ${objectDetails.riskLevel}, ${objectDetails.infestationLevel}
            ) RETURNING id, name, address
          `;
          objectId = uuidSchema.parse(clientObject.id);
          objectName = z.string().parse(clientObject.name);
          objectAddress = z.string().parse(clientObject.address);
          await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
            VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'client_object.create', 'client_object', ${objectId},
              ${transaction.json({ source: "quick_order", clientId, name: objectName, address: objectAddress })})`;
        }
      }

      const masterRows = input.order.assignedMasterId
        ? await transaction`SELECT id, full_name, phone FROM masters
            WHERE organization_id = ${member.organizationId} AND id = ${input.order.assignedMasterId} AND active AND operational_status = 'working'`
        : [];
      if (input.order.assignedMasterId && !masterRows.length) throw new QuickOrderReferenceError("master");
      const master = masterRows[0] ?? null;

      const serviceLines = input.order.services.map((service) => {
        const quantityMilliunits = parseQuantityToMilliunits(service.quantity);
        const unitPriceMinor = parseMoneyToMinorUnits(service.unitPrice);
        return {
          ...service,
          quantityMilliunits,
          unitPriceMinor,
          lineTotalMinor: calculateServiceLineTotalMinor(unitPriceMinor, quantityMilliunits),
        };
      });
      const agreedTotalMinor = serviceLines.reduce((total, service) => total + service.lineTotalMinor, 0n);
      const masterPaymentMinor = input.order.masterPayment === null ? null : parseMoneyToMinorUnits(input.order.masterPayment);
      const [counter] = await transaction`
        INSERT INTO organization_order_counters (organization_id, next_order_number)
        VALUES (${member.organizationId}, 1002)
        ON CONFLICT (organization_id) DO UPDATE
          SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
        RETURNING next_order_number - 1 AS allocated_number
      `;
      const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
      const [order] = await transaction`
        INSERT INTO orders (
          organization_id, client_id, object_id, client_contact_id, source_lead_id, order_number, status, currency,
          agreed_total_minor, assigned_master_id, master_payment_snapshot_minor,
          client_name_snapshot, object_name_snapshot, object_address_snapshot,
          contact_name_snapshot, contact_phone_snapshot, master_name_snapshot, master_phone_snapshot,
          notes, created_by
        ) VALUES (
          ${member.organizationId}, ${clientId}, ${objectId}, ${contactId}, ${input.sourceLead?.id ?? null}, ${orderNumber}, 'scheduled', 'RUB',
          ${agreedTotalMinor.toString()}, ${input.order.assignedMasterId}, ${masterPaymentMinor?.toString() ?? null},
          ${clientName}, ${objectName}, ${objectAddress}, ${contactName}, ${contactPhone},
          ${master?.full_name ?? null}, ${master?.phone ?? null}, ${input.order.notes}, ${member.memberId}
        ) RETURNING id
      `;
      const orderId = uuidSchema.parse(order.id);

      for (const [index, service] of serviceLines.entries()) {
        await transaction`INSERT INTO order_services (
          organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position, note
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${service.name}, ${formatQuantityForDatabase(service.quantityMilliunits)},
          ${service.unitPriceMinor.toString()}, ${service.lineTotalMinor.toString()}, ${index + 1}, ${service.note}
        )`;
      }
      for (const expense of input.order.expenses) {
        await transaction`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
          VALUES (${member.organizationId}, ${orderId}, ${expense.category}, ${parseMoneyToMinorUnits(expense.amount).toString()},
            ${expense.occurredOn}, ${expense.note}, ${member.memberId})`;
      }

      const [rangeRow] = await transaction`SELECT
        ((${input.visit.localDate} || ' ' || ${input.visit.localTime})::timestamp AT TIME ZONE timezone) AS start_at,
        ((${input.visit.localDate} || ' ' || ${input.visit.localTime})::timestamp AT TIME ZONE timezone)
          + make_interval(mins => ${input.visit.durationMinutes}) AS end_at
        FROM organizations WHERE id = ${member.organizationId}`;
      const range = timestampRangeSchema.parse(rangeRow);
      if (input.visit.assignedMasterId) {
        const conflicts = await transaction`SELECT id FROM service_visits
          WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${input.visit.assignedMasterId}
            AND status <> 'cancelled' AND scheduled_start_at < ${range.end_at} AND scheduled_end_at > ${range.start_at}
          LIMIT 1`;
        if (conflicts.length) throw new QuickOrderScheduleConflictError();
      }
      const [visit] = await transaction`INSERT INTO service_visits (
        organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
        client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot,
        notes, created_by, updated_by
      ) VALUES (
        ${member.organizationId}, ${orderId}, ${objectId}, ${input.visit.assignedMasterId}, ${range.start_at}, ${range.end_at}, 'planned',
        ${clientName}, ${objectName}, ${objectAddress}, ${master?.full_name ?? null}, ${master?.phone ?? null},
        ${input.visit.notes}, ${member.memberId}, ${member.memberId}
      ) RETURNING id`;
      const visitId = uuidSchema.parse(visit.id);
      const visitAfterState = {
        scheduledStartAt: range.start_at.toISOString(),
        scheduledEndAt: range.end_at.toISOString(),
        status: "planned",
        assignedMasterId: input.visit.assignedMasterId,
        notes: input.visit.notes,
      };
      await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
        VALUES (${member.organizationId}, ${visitId}, ${member.memberId}, 'created', ${transaction.json(visitAfterState)})`;
      await transaction`INSERT INTO tasks (
        organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, related_visit_id,
        source, reminder_kind, created_by, updated_by
      ) VALUES (
        ${member.organizationId}, ${`Подготовить выезд ${orderNumber}`}, 'Автоматическое напоминание по дате выезда.', 'high',
        ${range.start_at} - interval '1 day', ${member.memberId}, ${orderId}, ${visitId},
        'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
      )`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${orderId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (input.sourceLead) {
        const updatedLeads = await transaction`UPDATE website_leads
          SET moderation_status = 'accepted', reviewed_by = ${member.memberId}, reviewed_at = now(),
            review_note = ${`Создан заказ ${orderNumber}`}, updated_at = now(), version = version + 1
          WHERE organization_id = ${member.organizationId} AND id = ${input.sourceLead.id}
            AND version = ${input.sourceLead.expectedVersion} AND moderation_status IN ('new', 'reviewing')`;
        if (updatedLeads.count !== 1) throw new QuickOrderLeadConflictError();
      }
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.create', 'order', ${orderId},
          ${transaction.json({ source: input.sourceLead ? "website_lead" : "quick_order", sourceLeadId: input.sourceLead?.id ?? null, orderNumber, clientId, objectId, serviceCount: serviceLines.length, agreedTotalMinor: agreedTotalMinor.toString() })})`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.create', 'service_visit', ${visitId},
          ${transaction.json({ source: "quick_order", orderId, ...visitAfterState })})`;

      return { clientId, objectId, contactId, orderId, orderNumber, visitId };
    });
  } catch (error) {
    const constraint = databaseConstraint(error);
    if (constraint === "clients_organization_tax_id_unique_idx") throw new QuickOrderConflictError("client");
    if (constraint === "client_contacts_client_phone_unique_idx") throw new QuickOrderConflictError("contact");
    if (constraint === "client_objects_client_address_unique_idx") throw new QuickOrderConflictError("object");
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new QuickOrderScheduleConflictError();
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new QuickOrderScheduleConflictError();
    throw error;
  }
}
