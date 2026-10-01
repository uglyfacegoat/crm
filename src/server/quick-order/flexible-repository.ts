import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import { publishOrderCreated } from "@/server/domain-events/order-created";
import { calculateServiceLineTotalMinor, formatQuantityForDatabase, parseMoneyToMinorUnits, parseQuantityToMilliunits } from "@/server/orders/money";
import type { FlexibleOrderInput } from "./flexible-schemas";

const uuid = z.string().uuid();
export class FlexibleOrderConflictError extends Error { constructor() { super("Client, contact or object already exists."); } }
export class FlexibleOrderReferenceError extends Error { constructor() { super("Selected client, contact, object or catalog item is unavailable."); } }
export class FlexibleOrderLeadConflictError extends Error { constructor() { super("Incoming lead changed or was already accepted."); } }
export class FlexibleOrderScheduleConflictError extends Error { constructor() { super("Master already has a visit in this time range."); } }

export async function createFlexibleOrder(member: AuthenticatedMember, input: FlexibleOrderInput): Promise<string> {
  requirePermission(member, "clients.write");
  requirePermission(member, "orders.write");
  if (input.masterPayment && !hasPermission(member, "finance.write")) requirePermission(member, "finance.write");
  if (input.visit) requirePermission(member, "visits.write");
  if (input.sourceLead) requirePermission(member, "leads.write");
  const sql = getDatabase();
  const inputPhones = [
    ...(input.client.mode === "new" && input.client.primaryPhone ? [input.client.primaryPhone] : []),
    ...input.phones.map((item) => item.phone),
    ...input.contacts.flatMap((item) => [item.phone, ...item.phones.map((entry) => entry.phone)].filter(Boolean)),
  ].map(normalizeContactPhone);
  if (new Set(inputPhones).size !== inputPhones.length) throw new FlexibleOrderConflictError();
  try {
    return await sql.begin(async (transaction) => {
      const claimed = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'orders.create_flexible')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!claimed.length) {
        const [previous] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (previous?.operation !== "orders.create_flexible" || !previous.entity_id) throw new Error("Idempotency key is already used.");
        return uuid.parse(previous.entity_id);
      }

      if (input.sourceLead) {
        const [lead] = await transaction`SELECT moderation_status, version FROM website_leads
          WHERE organization_id = ${member.organizationId} AND id = ${input.sourceLead.id} FOR UPDATE`;
        if (!lead || !["new", "reviewing"].includes(z.string().parse(lead.moderation_status)) || z.number().int().parse(lead.version) !== input.sourceLead.expectedVersion) throw new FlexibleOrderLeadConflictError();
      }

      let clientId: string;
      let clientName: string;
      if (input.client.mode === "new") {
        const [created] = await transaction`INSERT INTO clients (organization_id, legal_name, kind, tax_id, primary_phone, primary_email)
          VALUES (${member.organizationId}, ${input.client.name}, ${input.client.kind}, ${input.client.taxId || null}, ${input.client.primaryPhone ? normalizeContactPhone(input.client.primaryPhone) : null}, ${input.client.email || null}) RETURNING id, legal_name`;
        clientId = uuid.parse(created.id);
        clientName = z.string().parse(created.legal_name);
      } else {
        const [existing] = await transaction`SELECT id, legal_name FROM clients WHERE organization_id = ${member.organizationId} AND id = ${input.client.clientId}`;
        if (!existing) throw new FlexibleOrderReferenceError();
        clientId = uuid.parse(existing.id);
        clientName = z.string().parse(existing.legal_name);
      }

      const contacts: Array<{ id: string; name: string; phone: string }> = [];
      if (input.client.mode === "existing" && input.client.existingContactId) {
        const [selected] = await transaction`SELECT id, full_name, phone FROM client_contacts WHERE organization_id = ${member.organizationId} AND client_id = ${clientId} AND id = ${input.client.existingContactId}`;
        if (!selected) throw new FlexibleOrderReferenceError();
        contacts.push({ id: uuid.parse(selected.id), name: z.string().parse(selected.full_name), phone: z.string().parse(selected.phone) });
      }
      if (input.client.mode === "new" && (input.client.primaryContactName || input.client.primaryPhone)) {
        const name = input.client.primaryContactName || clientName.slice(0, 200);
        const phone = input.client.primaryPhone;
        const [created] = await transaction`INSERT INTO client_contacts (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
          VALUES (${member.organizationId}, ${clientId}, ${name}, ${input.client.primaryContactPosition || null}, ${phone}, ${phone ? normalizeContactPhone(phone) : null}, ${input.client.email || null}, true) RETURNING id`;
        contacts.push({ id: uuid.parse(created.id), name, phone });
      }

      for (const [index, entry] of input.contacts.entries()) {
        const [created] = await transaction`INSERT INTO client_contacts (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
          VALUES (${member.organizationId}, ${clientId}, ${entry.name}, ${entry.position || null}, ${entry.phone}, ${entry.phone ? normalizeContactPhone(entry.phone) : null}, ${entry.email || null}, ${input.client.mode === "new" && contacts.length === 0 && index === 0}) RETURNING id`;
        const contactId = uuid.parse(created.id);
        contacts.push({ id: contactId, name: entry.name, phone: entry.phone });
        for (const extra of entry.phones) await transaction`INSERT INTO client_phone_numbers (organization_id, client_id, contact_id, label, phone, normalized_phone)
          VALUES (${member.organizationId}, ${clientId}, ${contactId}, ${extra.label || "Дополнительный"}, ${extra.phone}, ${normalizeContactPhone(extra.phone)})`;
        if (entry.phone) await transaction`UPDATE clients SET primary_phone = COALESCE(primary_phone, ${normalizeContactPhone(entry.phone)}), updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${clientId}`;
      }
      for (const extra of input.phones) await transaction`INSERT INTO client_phone_numbers (organization_id, client_id, label, phone, normalized_phone)
        VALUES (${member.organizationId}, ${clientId}, ${extra.label || "Дополнительный"}, ${extra.phone}, ${normalizeContactPhone(extra.phone)})`;
      if (input.phones[0]) await transaction`UPDATE clients SET primary_phone = COALESCE(primary_phone, ${normalizeContactPhone(input.phones[0].phone)}), updated_at = now() WHERE organization_id = ${member.organizationId} AND id = ${clientId}`;

      const objects: Array<{ id: string; name: string; address: string }> = [];
      for (const objectId of input.existingObjectIds) {
        const [selected] = await transaction`SELECT id, name, address FROM client_objects WHERE organization_id = ${member.organizationId} AND client_id = ${clientId} AND id = ${objectId}`;
        if (!selected) throw new FlexibleOrderReferenceError();
        objects.push({ id: uuid.parse(selected.id), name: z.string().parse(selected.name), address: z.string().parse(selected.address) });
      }
      for (const entry of input.objects) {
        const name = entry.name || entry.address.slice(0, 240);
        const [created] = await transaction`INSERT INTO client_objects (
          organization_id, client_id, name, object_type, address, area_square_meters, floor_count,
          onsite_contact, access_instructions, parking_notes, restrictions, risk_level, infestation_level
        ) VALUES (
          ${member.organizationId}, ${clientId}, ${name}, ${entry.objectType || "Не указан"}, ${entry.address},
          ${entry.areaSquareMeters ? entry.areaSquareMeters.replace(",", ".") : null}, ${entry.floorCount || null},
          ${entry.onsiteContact || null}, ${entry.accessInstructions || null}, ${entry.parkingNotes || null}, ${entry.restrictions || null},
          ${entry.riskLevel}, ${entry.infestationLevel}
        ) RETURNING id`;
        objects.push({ id: uuid.parse(created.id), name, address: entry.address });
      }

      const lines = input.services.map((entry) => {
        const quantityMilliunits = parseQuantityToMilliunits(entry.quantity);
        const unitPriceMinor = entry.unitPrice ? parseMoneyToMinorUnits(entry.unitPrice) : 0n;
        return { ...entry, quantityMilliunits, unitPriceMinor, lineTotalMinor: calculateServiceLineTotalMinor(unitPriceMinor, quantityMilliunits) };
      });
      const pricePending = !input.manualPrice && (lines.length === 0 || lines.some((line) => !line.unitPrice));
      const agreedTotalMinor = input.manualPrice ? parseMoneyToMinorUnits(input.manualPrice) : lines.reduce((sum, line) => sum + line.lineTotalMinor, 0n);
      const [counter] = await transaction`INSERT INTO organization_order_counters (organization_id, next_order_number)
        VALUES (${member.organizationId}, 1002) ON CONFLICT (organization_id) DO UPDATE SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
        RETURNING next_order_number - 1 AS allocated_number`;
      const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
      const primaryContact = contacts[0] ?? null;
      const primaryObject = objects[0] ?? null;
      const masterRows = input.assignedMasterId ? await transaction`SELECT id, full_name, phone FROM masters
        WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active AND operational_status = 'working'` : [];
      if (input.assignedMasterId && !masterRows.length) throw new FlexibleOrderReferenceError();
      const master = masterRows[0] ?? null;
      const masterPaymentMinor = input.masterPayment ? parseMoneyToMinorUnits(input.masterPayment) : null;
      const [createdOrder] = await transaction`INSERT INTO orders (
        organization_id, client_id, object_id, client_contact_id, source_lead_id, order_number, status, currency, agreed_total_minor, price_pending,
        assigned_master_id, master_payment_snapshot_minor, master_name_snapshot, master_phone_snapshot,
        client_name_snapshot, object_name_snapshot, object_address_snapshot, contact_name_snapshot, contact_phone_snapshot, notes, created_by
      ) VALUES (
        ${member.organizationId}, ${clientId}, ${primaryObject?.id ?? null}, ${primaryContact?.id ?? null}, ${input.sourceLead?.id ?? null}, ${orderNumber}, ${input.visit ? "scheduled" : "new"}, 'RUB', ${agreedTotalMinor.toString()}, ${pricePending},
        ${input.assignedMasterId}, ${masterPaymentMinor?.toString() ?? null}, ${master?.full_name ?? null}, ${master?.phone ?? null},
        ${clientName}, ${primaryObject?.name ?? "Объект не указан"}, ${primaryObject?.address || "Адрес не указан"}, ${primaryContact?.name ?? clientName}, ${primaryContact?.phone ?? ""}, ${input.notes || null}, ${member.memberId}
      ) RETURNING id`;
      const orderId = uuid.parse(createdOrder.id);
      for (const [index, contact] of contacts.entries()) await transaction`INSERT INTO order_contacts (organization_id, order_id, contact_id, position)
        VALUES (${member.organizationId}, ${orderId}, ${contact.id}, ${index + 1})`;
      for (const [index, object] of objects.entries()) await transaction`INSERT INTO order_objects (organization_id, order_id, object_id, position)
        VALUES (${member.organizationId}, ${orderId}, ${object.id}, ${index + 1})`;
      for (const [index, line] of lines.entries()) {
        let kind: "service" | "product" = "service";
        let unit = "усл.";
        if (line.catalogItemId) {
          const [item] = await transaction`SELECT ci.kind, ci.unit FROM catalog_items ci
            WHERE ci.organization_id = ${member.organizationId} AND ci.id = ${line.catalogItemId}
              AND ci.active AND ci.name = ${line.name}`;
          if (!item) throw new FlexibleOrderReferenceError();
          kind = z.enum(["service", "product"]).parse(item.kind);
          unit = z.string().parse(item.unit);
        }
        await transaction`INSERT INTO order_services (organization_id, order_id, catalog_item_id, item_kind_snapshot, unit_snapshot, service_name_snapshot, quantity, unit_price_minor, line_total_minor, price_pending, position, note)
          VALUES (${member.organizationId}, ${orderId}, ${line.catalogItemId ?? null}, ${kind}, ${unit}, ${line.name}, ${formatQuantityForDatabase(line.quantityMilliunits)}, ${line.unitPriceMinor.toString()}, ${line.lineTotalMinor.toString()}, ${!line.unitPrice}, ${index + 1}, ${line.note || null})`;
      }
      if (input.visit && primaryObject) {
        const visit = input.visit;
        const [range] = await transaction`SELECT
          ((${visit.localDate} || ' ' || ${visit.localTime})::timestamp AT TIME ZONE timezone) AS start_at,
          CASE WHEN ${visit.arrivalMode} = 'fixed'
            THEN ((${visit.localDate} || ' ' || ${visit.localTime})::timestamp AT TIME ZONE timezone) + interval '2 hours'
            ELSE (((${visit.localDate} || ' ' || ${visit.endTime})::timestamp
              + CASE WHEN ${visit.endTime}::time < ${visit.localTime}::time THEN interval '1 day' ELSE interval '0 day' END) AT TIME ZONE timezone)
          END AS end_at
          FROM organizations WHERE id = ${member.organizationId}`;
        if (!range) throw new FlexibleOrderReferenceError();
        if (input.assignedMasterId) {
          const conflicts = await transaction`SELECT id FROM service_visits
            WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${input.assignedMasterId}
              AND status <> 'cancelled' AND scheduled_start_at < ${range.end_at} AND scheduled_end_at > ${range.start_at}
            LIMIT 1`;
          if (conflicts.length) throw new FlexibleOrderScheduleConflictError();
        }
        const [createdVisit] = await transaction`INSERT INTO service_visits (
          organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, arrival_mode, status,
          client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot,
          notes, created_by, updated_by
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${primaryObject.id}, ${input.assignedMasterId}, ${range.start_at}, ${range.end_at}, ${visit.arrivalMode}, 'planned',
          ${clientName}, ${primaryObject.name}, ${primaryObject.address}, ${master?.full_name ?? null}, ${master?.phone ?? null},
          ${visit.notes || null}, ${member.memberId}, ${member.memberId}
        ) RETURNING id`;
        const visitId = uuid.parse(createdVisit.id);
        await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
          VALUES (${member.organizationId}, ${visitId}, ${member.memberId}, 'created',
            ${transaction.json({ scheduledStartAt: new Date(range.start_at).toISOString(), scheduledEndAt: new Date(range.end_at).toISOString(), arrivalMode: visit.arrivalMode, status: "planned", assignedMasterId: input.assignedMasterId, notes: visit.notes || null })})`;
        await transaction`INSERT INTO tasks (
          organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, related_visit_id,
          source, reminder_kind, created_by, updated_by
        ) VALUES (
          ${member.organizationId}, ${`Подготовить выезд ${orderNumber}`}, 'Автоматическое напоминание по дате выезда.', 'high',
          ${range.start_at} - interval '1 day', ${member.memberId}, ${orderId}, ${visitId},
          'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
        )`;
      }
      if (input.sourceLead) {
        const updated = await transaction`UPDATE website_leads
          SET moderation_status = 'accepted', reviewed_by = ${member.memberId}, reviewed_at = now(),
            review_note = ${`Создан заказ ${orderNumber}`}, updated_at = now(), version = version + 1
          WHERE organization_id = ${member.organizationId} AND id = ${input.sourceLead.id}
            AND version = ${input.sourceLead.expectedVersion} AND moderation_status IN ('new', 'reviewing')`;
        if (updated.count !== 1) throw new FlexibleOrderLeadConflictError();
      }
      await transaction`UPDATE idempotency_requests SET entity_id = ${orderId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.create', 'order', ${orderId},
          ${transaction.json({ source: input.sourceLead ? "website_lead" : "flexible_order", sourceLeadId: input.sourceLead?.id ?? null, clientId, orderNumber, contactCount: contacts.length, objectCount: objects.length, phoneCount: inputPhones.length, pricePending, agreedTotalMinor: agreedTotalMinor.toString(), hasVisit: Boolean(input.visit) })})`;
      await publishOrderCreated(transaction, member.organizationId, orderId);
      return orderId;
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23P01") throw new FlexibleOrderScheduleConflictError();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new FlexibleOrderConflictError();
    throw error;
  }
}
