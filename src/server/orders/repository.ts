import "server-only";
import { z } from "zod";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { calculateOrderEconomics } from "@/server/domain/order-economics";
import {
  calculateServiceLineTotalMinor,
  formatQuantityForDatabase,
  minorUnitsToSafeNumber,
  minimumRecordedOrderTotalMinor,
  parseMoneyToMinorUnits,
  parseQuantityToMilliunits,
} from "./money";
import type { AddOrderExpenseInput, CreateOrderInput, UpdateOrderInput } from "./schemas";
import { orderStatusLabels, type OrderCreationOptions, type OrderDetail, type OrderListItem } from "./types";

const uuidSchema = z.string().uuid();
const minorUnitsSchema = z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]).transform(minorUnitsToSafeNumber);
const nullableMinorUnitsSchema = z.union([z.null(), z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()])
  .transform((value) => value === null ? null : minorUnitsToSafeNumber(value));
const orderListRowSchema = z.object({
  id: uuidSchema,
  order_number: z.string(),
  client_name_snapshot: z.string(),
  object_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  service_summary: z.string(),
  agreed_total_minor: minorUnitsSchema,
  created_at: z.coerce.date(),
  status: z.enum(["new", "approval", "scheduled", "in_progress", "completed", "overdue", "cancelled"]),
  master_name_snapshot: z.string().nullable(),
});
const orderDetailRowSchema = orderListRowSchema.extend({
  client_id: uuidSchema,
  object_id: uuidSchema,
  client_contact_id: uuidSchema.nullable(),
  contact_name_snapshot: z.string().nullable(),
  contact_phone_snapshot: z.string().nullable(),
  status_reason: z.string().nullable(),
  currency: z.literal("RUB"),
  invoiced_total_minor: minorUnitsSchema,
  paid_total_minor: minorUnitsSchema,
  assigned_master_id: uuidSchema.nullable(),
  master_phone_snapshot: z.string().nullable(),
  master_payment_snapshot_minor: nullableMinorUnitsSchema,
  master_paid_total_minor: minorUnitsSchema,
  notes: z.string().nullable(),
  version: z.number().int().positive(),
});
const serviceRowSchema = z.object({
  id: uuidSchema,
  service_name_snapshot: z.string(),
  quantity: z.string(),
  unit_price_minor: minorUnitsSchema,
  line_total_minor: minorUnitsSchema,
  note: z.string().nullable(),
});
const expenseRowSchema = z.object({
  id: uuidSchema,
  category: z.string(),
  amount_minor: minorUnitsSchema,
  occurred_on: z.string(),
  note: z.string().nullable(),
});
const optionRowSchema = z.object({ id: uuidSchema, name: z.string() });
const objectOptionRowSchema = optionRowSchema.extend({ client_id: uuidSchema, address: z.string() });
const contactOptionRowSchema = optionRowSchema.extend({ client_id: uuidSchema, phone: z.string(), is_primary: z.boolean() });
const masterOptionRowSchema = optionRowSchema.extend({ phone: z.string() });

export class OrderNotFoundError extends Error {
  constructor() { super("Order was not found."); this.name = "OrderNotFoundError"; }
}

export class OrderVersionConflictError extends Error {
  constructor() { super("Order was changed by another member."); this.name = "OrderVersionConflictError"; }
}

export class OrderReferenceError extends Error {
  constructor(readonly field: "client" | "object" | "contact" | "master") {
    super(`The selected ${field} is unavailable.`);
    this.name = "OrderReferenceError";
  }
}

export class OrderTotalBelowRecordedFinancialsError extends Error {
  constructor(readonly minimumTotalMinor: bigint) {
    super("Order total cannot be lower than invoiced or paid amounts.");
    this.name = "OrderTotalBelowRecordedFinancialsError";
  }
}

export class OrderMasterFinancialsLockedError extends Error {
  constructor(readonly paidMinor: bigint) {
    super("Master assignment and accrued payment cannot invalidate posted payouts.");
    this.name = "OrderMasterFinancialsLockedError";
  }
}

function requireOrderRead(member: AuthenticatedMember) {
  requirePermission(member, "orders.read");
  // A master account is not yet linked to a masters row. Denying access avoids exposing
  // unrelated customer orders until that resource-level relationship exists.
  if (member.role === "master") throw new AuthorizationError();
}

function mapListRow(row: unknown): OrderListItem {
  const order = orderListRowSchema.parse(row);
  return {
    id: order.id,
    number: order.order_number,
    client: order.client_name_snapshot,
    object: order.object_name_snapshot,
    address: order.object_address_snapshot,
    serviceSummary: order.service_summary,
    agreedTotalMinor: order.agreed_total_minor,
    createdAt: order.created_at.toISOString(),
    status: orderStatusLabels[order.status],
    master: order.master_name_snapshot,
  };
}

export async function listOrders(member: AuthenticatedMember): Promise<OrderListItem[]> {
  requireOrderRead(member);
  const sql = getDatabase();
  const rows = await sql`
    SELECT orders.id, orders.order_number, orders.client_name_snapshot, orders.object_name_snapshot,
      orders.object_address_snapshot, orders.agreed_total_minor, orders.created_at, orders.status,
      orders.master_name_snapshot, coalesce(services.service_summary, 'Услуги не указаны') AS service_summary
    FROM orders
    LEFT JOIN LATERAL (
      SELECT string_agg(order_services.service_name_snapshot, ', ' ORDER BY order_services.position) AS service_summary
      FROM order_services
      WHERE order_services.organization_id = orders.organization_id AND order_services.order_id = orders.id
    ) services ON true
    WHERE orders.organization_id = ${member.organizationId}
    ORDER BY orders.created_at DESC
    LIMIT 200
  `;
  return rows.map(mapListRow);
}

export async function listOrdersWithoutActiveVisit(member: AuthenticatedMember): Promise<OrderListItem[]> {
  requireOrderRead(member);
  const sql = getDatabase();
  const rows = await sql`
    SELECT orders.id, orders.order_number, orders.client_name_snapshot, orders.object_name_snapshot,
      orders.object_address_snapshot, orders.agreed_total_minor, orders.created_at, orders.status,
      orders.master_name_snapshot, coalesce(services.service_summary, 'Услуги не указаны') AS service_summary
    FROM orders
    LEFT JOIN LATERAL (
      SELECT string_agg(order_services.service_name_snapshot, ', ' ORDER BY order_services.position) AS service_summary
      FROM order_services
      WHERE order_services.organization_id = orders.organization_id AND order_services.order_id = orders.id
    ) services ON true
    WHERE orders.organization_id = ${member.organizationId}
      AND orders.status NOT IN ('completed', 'cancelled')
      AND NOT EXISTS (
        SELECT 1
        FROM service_visits
        WHERE service_visits.organization_id = orders.organization_id
          AND service_visits.order_id = orders.id
          AND service_visits.status NOT IN ('completed', 'cancelled')
      )
    ORDER BY orders.created_at DESC
    LIMIT 100
  `;
  return rows.map(mapListRow);
}

export async function listOrderCreationOptions(member: AuthenticatedMember): Promise<OrderCreationOptions> {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  const [clientRows, objectRows, contactRows, masterRows] = await Promise.all([
    sql`SELECT id, legal_name AS name FROM clients WHERE organization_id = ${member.organizationId} ORDER BY legal_name`,
    sql`SELECT id, client_id, name, address FROM client_objects WHERE organization_id = ${member.organizationId} ORDER BY name`,
    sql`SELECT id, client_id, full_name AS name, phone, is_primary FROM client_contacts WHERE organization_id = ${member.organizationId} ORDER BY is_primary DESC, full_name`,
    sql`SELECT id, full_name AS name, phone FROM masters WHERE organization_id = ${member.organizationId} AND active ORDER BY full_name`,
  ]);
  return {
    clients: clientRows.map((row) => optionRowSchema.parse(row)),
    objects: objectRows.map((row) => { const parsed = objectOptionRowSchema.parse(row); return { id: parsed.id, clientId: parsed.client_id, name: parsed.name, address: parsed.address }; }),
    contacts: contactRows.map((row) => { const parsed = contactOptionRowSchema.parse(row); return { id: parsed.id, clientId: parsed.client_id, name: parsed.name, phone: parsed.phone, isPrimary: parsed.is_primary }; }),
    masters: masterRows.map((row) => masterOptionRowSchema.parse(row)),
  };
}

export async function getOrderDetail(member: AuthenticatedMember, orderId: string): Promise<OrderDetail> {
  requireOrderRead(member);
  const sql = getDatabase();
  const [orderRows, serviceRows, expenseRows] = await Promise.all([
    sql`SELECT orders.id, orders.order_number, orders.client_id, orders.object_id, orders.client_contact_id,
      orders.client_name_snapshot, orders.object_name_snapshot, orders.object_address_snapshot,
      orders.contact_name_snapshot, orders.contact_phone_snapshot, orders.status, orders.status_reason,
      orders.currency, orders.agreed_total_minor, orders.invoiced_total_minor, orders.paid_total_minor,
      orders.assigned_master_id, orders.master_name_snapshot, orders.master_phone_snapshot,
      orders.master_payment_snapshot_minor, orders.master_paid_total_minor, orders.notes, orders.version, orders.created_at,
      coalesce(services.service_summary, 'Услуги не указаны') AS service_summary
      FROM orders
      LEFT JOIN LATERAL (
        SELECT string_agg(order_services.service_name_snapshot, ', ' ORDER BY order_services.position) AS service_summary
        FROM order_services WHERE order_services.organization_id = orders.organization_id AND order_services.order_id = orders.id
      ) services ON true
      WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${orderId}`,
    sql`SELECT id, service_name_snapshot, quantity::text, unit_price_minor, line_total_minor, note
      FROM order_services WHERE organization_id = ${member.organizationId} AND order_id = ${orderId} ORDER BY position`,
    sql`SELECT id, category, amount_minor, occurred_on::text, note
      FROM order_expenses WHERE organization_id = ${member.organizationId} AND order_id = ${orderId} ORDER BY occurred_on DESC, created_at DESC`,
  ]);
  if (!orderRows.length) throw new OrderNotFoundError();
  const order = orderDetailRowSchema.parse(orderRows[0]);
  const services = serviceRows.map((row) => serviceRowSchema.parse(row));
  const expenses = expenseRows.map((row) => expenseRowSchema.parse(row));
  const economics = calculateOrderEconomics({
    agreedTotalMinor: BigInt(order.agreed_total_minor),
    invoicedTotalMinor: BigInt(order.invoiced_total_minor),
    paidTotalMinor: BigInt(order.paid_total_minor),
    masterPaymentsMinor: order.master_payment_snapshot_minor === null ? [] : [BigInt(order.master_payment_snapshot_minor)],
    directExpensesMinor: expenses.map((expense) => BigInt(expense.amount_minor)),
  });
  return {
    ...mapListRow(orderRows[0]),
    clientId: order.client_id,
    objectId: order.object_id,
    contactId: order.client_contact_id,
    contactName: order.contact_name_snapshot ?? "Не указан",
    contactPhone: order.contact_phone_snapshot ?? "Не указан",
    statusCode: order.status,
    statusReason: order.status_reason,
    currency: order.currency,
    invoicedTotalMinor: order.invoiced_total_minor,
    paidTotalMinor: order.paid_total_minor,
    assignedMasterId: order.assigned_master_id,
    masterPhone: order.master_phone_snapshot,
    masterPaymentMinor: order.master_payment_snapshot_minor,
    masterPaidTotalMinor: order.master_paid_total_minor,
    directExpensesMinor: minorUnitsToSafeNumber(economics.directExpensesMinor),
    projectedOperatingContributionMinor: minorUnitsToSafeNumber(economics.projectedOperatingContributionMinor),
    realizedOperatingContributionMinor: minorUnitsToSafeNumber(economics.realizedOperatingContributionMinor),
    outstandingInvoiceMinor: minorUnitsToSafeNumber(economics.outstandingInvoiceMinor),
    notes: order.notes,
    version: order.version,
    services: services.map((service) => ({
      id: service.id,
      name: service.service_name_snapshot,
      quantity: service.quantity,
      unitPriceMinor: service.unit_price_minor,
      lineTotalMinor: service.line_total_minor,
      note: service.note,
    })),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      category: expense.category,
      amountMinor: expense.amount_minor,
      occurredOn: expense.occurred_on,
      note: expense.note,
    })),
  };
}

export async function createOrder(member: AuthenticatedMember, input: CreateOrderInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const insertedRequest = await transaction`
      INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'orders.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key
    `;
    if (!insertedRequest.length) {
      const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existing?.operation !== "orders.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
      return uuidSchema.parse(existing.entity_id);
    }

    const [client] = await transaction`SELECT id, legal_name FROM clients WHERE organization_id = ${member.organizationId} AND id = ${input.clientId}`;
    if (!client) throw new OrderReferenceError("client");
    const [object] = await transaction`SELECT id, name, address FROM client_objects WHERE organization_id = ${member.organizationId} AND client_id = ${input.clientId} AND id = ${input.objectId}`;
    if (!object) throw new OrderReferenceError("object");
    const [contact] = await transaction`SELECT id, full_name, phone FROM client_contacts WHERE organization_id = ${member.organizationId} AND client_id = ${input.clientId} AND id = ${input.contactId}`;
    if (!contact) throw new OrderReferenceError("contact");
    const masterRows = input.assignedMasterId
      ? await transaction`SELECT id, full_name, phone FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active`
      : [];
    if (input.assignedMasterId && !masterRows.length) throw new OrderReferenceError("master");
    const master = masterRows[0] ?? null;

    const serviceLines = input.services.map((service) => {
      const quantityMilliunits = parseQuantityToMilliunits(service.quantity);
      const unitPriceMinor = parseMoneyToMinorUnits(service.unitPrice);
      return { ...service, quantityMilliunits, unitPriceMinor, lineTotalMinor: calculateServiceLineTotalMinor(unitPriceMinor, quantityMilliunits) };
    });
    const agreedTotalMinor = serviceLines.reduce((total, service) => total + service.lineTotalMinor, 0n);
    const masterPaymentMinor = input.masterPayment === null ? null : parseMoneyToMinorUnits(input.masterPayment);

    const [counter] = await transaction`
      INSERT INTO organization_order_counters (organization_id, next_order_number)
      VALUES (${member.organizationId}, 1002)
      ON CONFLICT (organization_id) DO UPDATE
      SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
      RETURNING next_order_number - 1 AS allocated_number
    `;
    const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
    const [order] = await transaction`INSERT INTO orders (
      organization_id, client_id, object_id, client_contact_id, order_number, status, currency,
      agreed_total_minor, assigned_master_id, master_payment_snapshot_minor,
      client_name_snapshot, object_name_snapshot, object_address_snapshot,
      contact_name_snapshot, contact_phone_snapshot, master_name_snapshot, master_phone_snapshot,
      notes, created_by
    ) VALUES (
      ${member.organizationId}, ${input.clientId}, ${input.objectId}, ${input.contactId}, ${orderNumber}, 'new', 'RUB',
      ${agreedTotalMinor.toString()}, ${input.assignedMasterId}, ${masterPaymentMinor?.toString() ?? null},
      ${client.legal_name}, ${object.name}, ${object.address}, ${contact.full_name}, ${contact.phone},
      ${master?.full_name ?? null}, ${master?.phone ?? null}, ${input.notes}, ${member.memberId}
    ) RETURNING id`;
    const orderId = uuidSchema.parse(order.id);

    for (const [index, service] of serviceLines.entries()) {
      await transaction`INSERT INTO order_services (
        organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position, note
      ) VALUES (
        ${member.organizationId}, ${orderId}, ${service.name}, ${formatQuantityForDatabase(service.quantityMilliunits)},
        ${service.unitPriceMinor.toString()}, ${service.lineTotalMinor.toString()}, ${index + 1}, ${service.note}
      )`;
    }
    for (const expense of input.expenses) {
      await transaction`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
        VALUES (${member.organizationId}, ${orderId}, ${expense.category}, ${parseMoneyToMinorUnits(expense.amount).toString()}, ${expense.occurredOn}, ${expense.note}, ${member.memberId})`;
    }
    await transaction`UPDATE idempotency_requests SET entity_id = ${orderId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.create', 'order', ${orderId},
        ${transaction.json({ orderNumber, clientId: input.clientId, objectId: input.objectId, serviceCount: serviceLines.length, agreedTotalMinor: agreedTotalMinor.toString() })})`;
    return orderId;
  });
}

export async function updateOrder(member: AuthenticatedMember, input: UpdateOrderInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [existing] = await transaction`SELECT status, assigned_master_id, master_payment_snapshot_minor, master_paid_total_minor, notes, version,
      agreed_total_minor, invoiced_total_minor, paid_total_minor
      FROM orders WHERE organization_id = ${member.organizationId} AND id = ${input.orderId} FOR UPDATE`;
    if (!existing) throw new OrderNotFoundError();
    if (z.number().int().parse(existing.version) !== input.expectedVersion) throw new OrderVersionConflictError();
    const masterRows = input.assignedMasterId
      ? await transaction`SELECT id, full_name, phone FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active`
      : [];
    if (input.assignedMasterId && !masterRows.length) throw new OrderReferenceError("master");
    const master = masterRows[0] ?? null;
    const masterPaymentMinor = input.masterPayment === null ? null : parseMoneyToMinorUnits(input.masterPayment);
    const masterPaidMinor = BigInt(existing.master_paid_total_minor);
    const masterChanged = input.assignedMasterId !== existing.assigned_master_id;
    if (masterPaidMinor > 0n && (masterChanged || masterPaymentMinor === null || masterPaymentMinor < masterPaidMinor)) {
      throw new OrderMasterFinancialsLockedError(masterPaidMinor);
    }
    const serviceLines = input.services.map((service) => {
      const quantityMilliunits = parseQuantityToMilliunits(service.quantity);
      const unitPriceMinor = parseMoneyToMinorUnits(service.unitPrice);
      return { ...service, quantityMilliunits, unitPriceMinor, lineTotalMinor: calculateServiceLineTotalMinor(unitPriceMinor, quantityMilliunits) };
    });
    const agreedTotalMinor = serviceLines.reduce((total, service) => total + service.lineTotalMinor, 0n);
    const minimumTotalMinor = minimumRecordedOrderTotalMinor(BigInt(existing.invoiced_total_minor), BigInt(existing.paid_total_minor));
    if (agreedTotalMinor < minimumTotalMinor) throw new OrderTotalBelowRecordedFinancialsError(minimumTotalMinor);
    const previousServiceRows = await transaction`SELECT service_name_snapshot, quantity::text, unit_price_minor, line_total_minor, position, note
      FROM order_services WHERE organization_id = ${member.organizationId} AND order_id = ${input.orderId} ORDER BY position`;
    const [updated] = await transaction`UPDATE orders SET
      status = ${input.status}, status_reason = ${input.status === "cancelled" ? input.statusReason : null},
      assigned_master_id = ${input.assignedMasterId}, master_name_snapshot = ${master?.full_name ?? null},
      master_phone_snapshot = ${master?.phone ?? null}, master_payment_snapshot_minor = ${masterPaymentMinor?.toString() ?? null},
      notes = ${input.notes}, agreed_total_minor = ${agreedTotalMinor.toString()}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.orderId}
      RETURNING version`;
    await transaction`DELETE FROM order_services WHERE organization_id = ${member.organizationId} AND order_id = ${input.orderId}`;
    for (const [index, service] of serviceLines.entries()) {
      await transaction`INSERT INTO order_services (
        organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position, note
      ) VALUES (
        ${member.organizationId}, ${input.orderId}, ${service.name}, ${formatQuantityForDatabase(service.quantityMilliunits)},
        ${service.unitPriceMinor.toString()}, ${service.lineTotalMinor.toString()}, ${index + 1}, ${service.note}
      )`;
    }
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.update', 'order', ${input.orderId},
        ${transaction.json({ before: { status: existing.status, assignedMasterId: existing.assigned_master_id, masterPaymentMinor: existing.master_payment_snapshot_minor, notes: existing.notes, agreedTotalMinor: String(existing.agreed_total_minor), services: previousServiceRows, version: existing.version }, after: { status: input.status, assignedMasterId: input.assignedMasterId, masterPaymentMinor: masterPaymentMinor?.toString() ?? null, notes: input.notes, agreedTotalMinor: agreedTotalMinor.toString(), services: serviceLines.map((service, index) => ({ name: service.name, quantity: formatQuantityForDatabase(service.quantityMilliunits), unitPriceMinor: service.unitPriceMinor.toString(), lineTotalMinor: service.lineTotalMinor.toString(), position: index + 1, note: service.note })), version: updated.version } })})`;
    return z.number().int().positive().parse(updated.version);
  });
}

export async function addOrderExpense(member: AuthenticatedMember, input: AddOrderExpenseInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'order_expenses.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!insertedRequest.length) {
      const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existing?.operation !== "order_expenses.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
      return uuidSchema.parse(existing.entity_id);
    }
    const [order] = await transaction`SELECT id FROM orders WHERE organization_id = ${member.organizationId} AND id = ${input.orderId} FOR UPDATE`;
    if (!order) throw new OrderNotFoundError();
    const amountMinor = parseMoneyToMinorUnits(input.amount);
    const [expense] = await transaction`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
      VALUES (${member.organizationId}, ${input.orderId}, ${input.category}, ${amountMinor.toString()}, ${input.occurredOn}, ${input.note}, ${member.memberId}) RETURNING id`;
    const expenseId = uuidSchema.parse(expense.id);
    await transaction`UPDATE idempotency_requests SET entity_id = ${expenseId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order_expense.create', 'order_expense', ${expenseId},
        ${transaction.json({ orderId: input.orderId, category: input.category, amountMinor: amountMinor.toString(), occurredOn: input.occurredOn })})`;
    return expenseId;
  });
}
