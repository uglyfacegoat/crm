import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { isValidContactPhone, normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import { publishOrderCreated } from "@/server/domain-events/order-created";
import { parseMoneyToMinorUnits } from "@/server/orders/money";

export const minimalOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientKind: z.enum(["legal_entity", "individual"]),
  clientName: z.string().trim().min(2, "Укажите имя или название заказчика").max(300),
  phone: z.string().trim().refine((value) => !value || isValidContactPhone(value), "Укажите корректный телефон"),
  price: z.string().trim().refine((value) => {
    if (!value) return true;
    try { return parseMoneyToMinorUnits(value) >= 0n; } catch { return false; }
  }, "Укажите корректную цену"),
  existingClientId: z.union([z.literal(""), z.string().uuid()]).default(""),
  existingContactId: z.union([z.literal(""), z.string().uuid()]).default(""),
  contactName: z.string().trim().max(200).default(""),
  contactPosition: z.string().trim().max(120).default(""),
  email: z.union([z.literal(""), z.string().trim().email().max(254)]).default("").transform((value) => value.toLowerCase()),
  taxId: z.union([z.literal(""), z.string().regex(/^\d{10}(\d{2})?$/)]).default(""),
  notes: z.string().trim().max(4_000).default(""),
});

export async function createMinimalOrder(member: AuthenticatedMember, input: z.infer<typeof minimalOrderSchema>) {
  requirePermission(member, "clients.write");
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const inserted = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'orders.create_minimal')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!inserted.length) {
      const [previous] = await transaction`SELECT operation, entity_id FROM idempotency_requests
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (previous?.operation !== "orders.create_minimal" || !previous.entity_id) throw new Error("Invalid idempotency request");
      return z.string().uuid().parse(previous.entity_id);
    }
    let clientId: string;
    let clientName = input.clientName;
    if (input.existingClientId) {
      const [client] = await transaction`SELECT id, legal_name FROM clients
        WHERE organization_id = ${member.organizationId} AND id = ${input.existingClientId}`;
      if (!client) throw new Error("Selected client is unavailable");
      clientId = z.string().uuid().parse(client.id);
      clientName = z.string().parse(client.legal_name);
    } else {
      const [client] = await transaction`INSERT INTO clients
        (organization_id, legal_name, kind, tax_id, primary_phone, primary_email)
        VALUES (${member.organizationId}, ${input.clientName}, ${input.clientKind}, ${input.taxId || null}, ${input.phone ? normalizeContactPhone(input.phone) : null}, ${input.email || null})
        RETURNING id`;
      clientId = z.string().uuid().parse(client.id);
    }
    let contactId: string | null = null;
    let contactName = (input.contactName.length >= 2 ? input.contactName : clientName).slice(0, 200);
    let contactPhone = input.phone;
    if (input.existingContactId) {
      const [contact] = await transaction`SELECT id, full_name, phone FROM client_contacts
        WHERE organization_id = ${member.organizationId} AND client_id = ${clientId} AND id = ${input.existingContactId}`;
      if (!contact) throw new Error("Selected contact is unavailable");
      contactId = z.string().uuid().parse(contact.id);
      contactName = z.string().parse(contact.full_name);
      contactPhone = z.string().parse(contact.phone);
    } else if (input.phone || input.contactName.trim()) {
      const [contact] = await transaction`INSERT INTO client_contacts
        (organization_id, client_id, full_name, position, phone, normalized_phone, email, is_primary)
        VALUES (${member.organizationId}, ${clientId}, ${contactName}, ${input.contactPosition || null}, ${input.phone}, ${input.phone ? normalizeContactPhone(input.phone) : null}, ${input.email || null}, ${!input.existingClientId})
        RETURNING id`;
      contactId = z.string().uuid().parse(contact.id);
    }
    const [counter] = await transaction`INSERT INTO organization_order_counters (organization_id, next_order_number)
      VALUES (${member.organizationId}, 1002)
      ON CONFLICT (organization_id) DO UPDATE SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
      RETURNING next_order_number - 1 AS allocated_number`;
    const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
    const [order] = await transaction`INSERT INTO orders (
      organization_id, client_id, object_id, client_contact_id, order_number, status, currency, agreed_total_minor, price_pending,
      client_name_snapshot, object_name_snapshot, object_address_snapshot,
      contact_name_snapshot, contact_phone_snapshot, notes, created_by
    ) VALUES (
      ${member.organizationId}, ${clientId}, ${null}, ${contactId}, ${orderNumber}, 'new', 'RUB', ${input.price ? parseMoneyToMinorUnits(input.price).toString() : "0"}, ${!input.price},
      ${clientName}, 'Объект не указан', 'Адрес не указан', ${contactId ? contactName : null}, ${contactId ? contactPhone : null}, ${input.notes || null}, ${member.memberId}
    ) RETURNING id`;
    const orderId = z.string().uuid().parse(order.id);
    await transaction`UPDATE idempotency_requests SET entity_id = ${orderId}
      WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.create', 'order', ${orderId},
        ${transaction.json({ source: "minimal_order", clientId, orderNumber, agreedTotalMinor: input.price ? parseMoneyToMinorUnits(input.price).toString() : "0", pricePending: !input.price })})`;
    await publishOrderCreated(transaction, member.organizationId, orderId);
    return orderId;
  });
}
