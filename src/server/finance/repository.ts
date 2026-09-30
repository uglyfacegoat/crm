import "server-only";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { minorUnitsToSafeNumber, parseMoneyToMinorUnits } from "@/server/orders/money";
import type { CreateInvoiceInput, CreatePaymentInput, CreatePayoutInput, ReverseLedgerEntryInput, VoidInvoiceInput } from "./schemas";
import type { FinanceInvoice, FinanceOrder, FinancePayment, FinancePayout, FinanceSnapshot } from "./types";

const uuidSchema = z.string().uuid();
const minorSchema = z.union([z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]);
const orderRowSchema = z.object({
  id: uuidSchema, order_number: z.string(), client_name_snapshot: z.string(), object_name_snapshot: z.string(), status: z.string(),
  agreed_total_minor: minorSchema, invoiced_total_minor: minorSchema, paid_total_minor: minorSchema,
  assigned_master_id: uuidSchema.nullable(), master_name_snapshot: z.string().nullable(),
  master_payment_snapshot_minor: minorSchema.nullable(), master_paid_total_minor: minorSchema,
});
const invoiceRowSchema = z.object({
  id: uuidSchema, order_id: uuidSchema, invoice_number: z.string(), amount_minor: minorSchema,
  paid_minor: minorSchema, issued_on: z.string(), due_on: z.string(), status: z.enum(["issued", "void"]),
  overdue: z.boolean(), note: z.string().nullable(), void_reason: z.string().nullable(), version: z.number().int().positive(),
});
const paymentRowSchema = z.object({
  id: uuidSchema, invoice_id: uuidSchema, amount_minor: minorSchema, received_on: z.string(),
  payment_method: z.enum(["bank_transfer", "cash", "card", "other"]), reference: z.string().nullable(),
  note: z.string().nullable(), status: z.enum(["posted", "reversed"]), reversal_reason: z.string().nullable(), receipt_document_id: uuidSchema.nullable(), version: z.number().int().positive(),
});
const payoutRowSchema = z.object({
  id: uuidSchema, order_id: uuidSchema, order_number: z.string(), master_id: uuidSchema, master_name_snapshot: z.string(),
  amount_minor: minorSchema, paid_on: z.string(), payment_method: z.enum(["bank_transfer", "cash", "card", "other"]),
  reference: z.string().nullable(), note: z.string().nullable(), status: z.enum(["posted", "reversed"]),
  reversal_reason: z.string().nullable(), receipt_document_id: uuidSchema.nullable(), version: z.number().int().positive(),
});

export type FinanceReceiptFile = {
  documentId: string;
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export class FinanceReferenceError extends Error {
  constructor(readonly field: "order" | "invoice" | "master") { super(`The selected ${field} is unavailable.`); this.name = "FinanceReferenceError"; }
}
export class FinanceAmountExceedsBalanceError extends Error {
  constructor(readonly availableMinor: bigint) { super("The amount exceeds the available balance."); this.name = "FinanceAmountExceedsBalanceError"; }
}
export class FinanceInvoiceNumberConflictError extends Error {
  constructor() { super("Invoice number already exists."); this.name = "FinanceInvoiceNumberConflictError"; }
}
export class FinanceFutureDateError extends Error {
  constructor() { super("Financial transaction date cannot be in the future."); this.name = "FinanceFutureDateError"; }
}
export class FinanceEntryNotFoundError extends Error {
  constructor() { super("Ledger entry was not found."); this.name = "FinanceEntryNotFoundError"; }
}
export class FinanceEntryConflictError extends Error {
  constructor() { super("Ledger entry has already changed."); this.name = "FinanceEntryConflictError"; }
}
export class FinanceRequestConflictError extends Error {
  constructor() { super("Idempotency key is already used by another or incomplete operation."); this.name = "FinanceRequestConflictError"; }
}
export class FinanceInvoiceHasPaymentsError extends Error {
  constructor() { super("An invoice with posted payments cannot be voided."); this.name = "FinanceInvoiceHasPaymentsError"; }
}

export async function financeMutationExists(
  member: AuthenticatedMember,
  idempotencyKey: string,
  operation: "finance.payment.create" | "finance.payout.create",
) {
  requirePermission(member, "finance.write");
  const sql = getDatabase();
  const [existing] = await sql`SELECT operation, entity_id FROM idempotency_requests
    WHERE organization_id = ${member.organizationId} AND idempotency_key = ${idempotencyKey}`;
  if (!existing) return false;
  if (existing.operation !== operation || !existing.entity_id) throw new FinanceRequestConflictError();
  uuidSchema.parse(existing.entity_id);
  return true;
}

function databaseConstraint(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function mapPayment(value: unknown): FinancePayment {
  const row = paymentRowSchema.parse(value);
  return { id: row.id, amountMinor: minorUnitsToSafeNumber(row.amount_minor), receivedOn: row.received_on, method: row.payment_method, reference: row.reference, note: row.note, status: row.status, reversalReason: row.reversal_reason, receiptDocumentId: row.receipt_document_id, version: row.version };
}

function mapPayout(value: unknown): FinancePayout {
  const row = payoutRowSchema.parse(value);
  return { id: row.id, orderId: row.order_id, orderNumber: row.order_number, masterId: row.master_id, masterName: row.master_name_snapshot, amountMinor: minorUnitsToSafeNumber(row.amount_minor), paidOn: row.paid_on, method: row.payment_method, reference: row.reference, note: row.note, status: row.status, reversalReason: row.reversal_reason, receiptDocumentId: row.receipt_document_id, version: row.version };
}

async function createReceiptDocument(
  transaction: TransactionSql,
  member: AuthenticatedMember,
  receipt: FinanceReceiptFile,
  order: { id: string; clientId: string; objectId: string },
  title: string,
  description: string,
) {
  await transaction`SELECT pg_advisory_xact_lock(hashtext(${member.organizationId}), hashtext('finance-receipts-folder'))`;
  await transaction`INSERT INTO document_folders (organization_id, parent_folder_id, name, created_by)
    VALUES (${member.organizationId}, NULL, 'Чеки', ${member.memberId})
    ON CONFLICT DO NOTHING`;
  const [folder] = await transaction`SELECT id FROM document_folders
    WHERE organization_id = ${member.organizationId} AND parent_folder_id IS NULL AND lower(name) = lower('Чеки')`;
  const folderId = uuidSchema.parse(folder?.id);
  await transaction`INSERT INTO documents (
      id, organization_id, client_id, object_id, order_id, title, category, description, folder_id, created_by
    ) VALUES (
      ${receipt.documentId}, ${member.organizationId}, ${order.clientId}, ${order.objectId}, ${order.id}, ${title}, 'receipt',
      ${description}, ${folderId}, ${member.memberId}
    )`;
  const [version] = await transaction`INSERT INTO document_versions (
      organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension,
      size_bytes, sha256, uploaded_by
    ) VALUES (
      ${member.organizationId}, ${receipt.documentId}, 1, ${receipt.filename}, ${receipt.storageKey}, ${receipt.mimeType},
      ${receipt.extension}, ${receipt.sizeBytes}, ${receipt.sha256}, ${member.memberId}
    ) RETURNING id`;
  const versionId = uuidSchema.parse(version.id);
  await transaction`UPDATE documents SET current_version_id = ${versionId}
    WHERE organization_id = ${member.organizationId} AND id = ${receipt.documentId}`;
  await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.created', 'document', ${receipt.documentId},
      ${transaction.json({ orderId: order.id, category: "receipt", filename: receipt.filename, sizeBytes: receipt.sizeBytes, sha256: receipt.sha256, source: "finance" })})`;
}

export async function getFinanceSnapshot(member: AuthenticatedMember): Promise<FinanceSnapshot> {
  requirePermission(member, "finance.read");
  const sql = getDatabase();
  const [orderRows, invoiceRows, paymentRows, payoutRows, organizationRows] = await Promise.all([
    sql`SELECT id, order_number, client_name_snapshot, object_name_snapshot, status, agreed_total_minor,
        invoiced_total_minor, paid_total_minor, assigned_master_id, master_name_snapshot,
        master_payment_snapshot_minor, master_paid_total_minor
      FROM orders WHERE organization_id = ${member.organizationId} AND status <> 'cancelled'
      ORDER BY created_at DESC LIMIT 500`,
    sql`SELECT order_invoices.id, order_invoices.order_id, order_invoices.invoice_number,
        order_invoices.amount_minor, coalesce(sum(order_payments.amount_minor) FILTER (WHERE order_payments.status = 'posted'), 0)::bigint AS paid_minor,
        order_invoices.issued_on::text, order_invoices.due_on::text, order_invoices.status,
        (order_invoices.status = 'issued' AND order_invoices.due_on < (now() AT TIME ZONE organizations.timezone)::date
          AND coalesce(sum(order_payments.amount_minor) FILTER (WHERE order_payments.status = 'posted'), 0) < order_invoices.amount_minor) AS overdue,
        order_invoices.note, order_invoices.void_reason, order_invoices.version
      FROM order_invoices
      JOIN organizations ON organizations.id = order_invoices.organization_id
      LEFT JOIN order_payments ON order_payments.organization_id = order_invoices.organization_id AND order_payments.invoice_id = order_invoices.id
      WHERE order_invoices.organization_id = ${member.organizationId}
      GROUP BY order_invoices.id, organizations.timezone
      ORDER BY order_invoices.issued_on DESC, order_invoices.created_at DESC LIMIT 1000`,
    sql`SELECT id, invoice_id, amount_minor, received_on::text, payment_method, reference, note, status, reversal_reason, receipt_document_id, version
      FROM order_payments WHERE organization_id = ${member.organizationId}
      ORDER BY received_on DESC, created_at DESC LIMIT 2000`,
    sql`SELECT order_master_payouts.id, order_master_payouts.order_id, orders.order_number,
        order_master_payouts.master_id, order_master_payouts.master_name_snapshot, order_master_payouts.amount_minor,
        order_master_payouts.paid_on::text, order_master_payouts.payment_method, order_master_payouts.reference,
        order_master_payouts.note, order_master_payouts.status, order_master_payouts.reversal_reason, order_master_payouts.receipt_document_id, order_master_payouts.version
      FROM order_master_payouts JOIN orders
        ON orders.organization_id = order_master_payouts.organization_id AND orders.id = order_master_payouts.order_id
      WHERE order_master_payouts.organization_id = ${member.organizationId}
      ORDER BY order_master_payouts.paid_on DESC, order_master_payouts.created_at DESC LIMIT 2000`,
    sql`SELECT (now() AT TIME ZONE timezone)::date::text AS today FROM organizations WHERE id = ${member.organizationId}`,
  ]);
  const today = z.object({ today: z.string() }).parse(organizationRows[0]).today;
  const paymentsByInvoice = new Map<string, FinancePayment[]>();
  for (const value of paymentRows) {
    const row = paymentRowSchema.parse(value);
    const payments = paymentsByInvoice.get(row.invoice_id) ?? [];
    payments.push(mapPayment(row));
    paymentsByInvoice.set(row.invoice_id, payments);
  }
  const invoicesByOrder = new Map<string, FinanceInvoice[]>();
  for (const value of invoiceRows) {
    const row = invoiceRowSchema.parse(value);
    const amountMinor = minorUnitsToSafeNumber(row.amount_minor);
    const paidMinor = minorUnitsToSafeNumber(row.paid_minor);
    const invoice: FinanceInvoice = { id: row.id, number: row.invoice_number, amountMinor, paidMinor, outstandingMinor: Math.max(0, amountMinor - paidMinor), issuedOn: row.issued_on, dueOn: row.due_on, status: row.status, overdue: row.overdue, note: row.note, voidReason: row.void_reason, version: row.version, payments: paymentsByInvoice.get(row.id) ?? [] };
    const invoices = invoicesByOrder.get(row.order_id) ?? [];
    invoices.push(invoice);
    invoicesByOrder.set(row.order_id, invoices);
  }
  const orders: FinanceOrder[] = orderRows.map((value) => {
    const row = orderRowSchema.parse(value);
    const invoicedMinor = minorUnitsToSafeNumber(row.invoiced_total_minor);
    const paidMinor = minorUnitsToSafeNumber(row.paid_total_minor);
    const masterAccruedMinor = row.master_payment_snapshot_minor === null ? 0 : minorUnitsToSafeNumber(row.master_payment_snapshot_minor);
    const masterPaidMinor = minorUnitsToSafeNumber(row.master_paid_total_minor);
    return { id: row.id, number: row.order_number, client: row.client_name_snapshot, object: row.object_name_snapshot, status: row.status,
      agreedMinor: minorUnitsToSafeNumber(row.agreed_total_minor), invoicedMinor, paidMinor, receivableMinor: Math.max(0, invoicedMinor - paidMinor),
      masterId: row.assigned_master_id, masterName: row.master_name_snapshot, masterAccruedMinor, masterPaidMinor,
      masterDueMinor: Math.max(0, masterAccruedMinor - masterPaidMinor), invoices: invoicesByOrder.get(row.id) ?? [] };
  });
  const payouts = payoutRows.map(mapPayout);
  const activeInvoices = orders.flatMap((order) => order.invoices).filter((invoice) => invoice.status === "issued");
  const sum = (values: number[]) => values.reduce((total, amount) => total + amount, 0);
  return { today, orders, payouts, summary: {
    agreedMinor: sum(orders.map((order) => order.agreedMinor)), invoicedMinor: sum(orders.map((order) => order.invoicedMinor)),
    receivedMinor: sum(orders.map((order) => order.paidMinor)), receivableMinor: sum(orders.map((order) => order.receivableMinor)),
    overdueMinor: sum(activeInvoices.filter((invoice) => invoice.overdue).map((invoice) => invoice.outstandingMinor)),
    masterAccruedMinor: sum(orders.map((order) => order.masterAccruedMinor)), masterPaidMinor: sum(orders.map((order) => order.masterPaidMinor)),
    masterDueMinor: sum(orders.map((order) => order.masterDueMinor)),
  } };
}

export async function createInvoice(member: AuthenticatedMember, input: CreateInvoiceInput) {
  requirePermission(member, "finance.write");
  const amountMinor = parseMoneyToMinorUnits(input.amount);
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'finance.invoice.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!request.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "finance.invoice.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(existing.entity_id);
      }
      const [order] = await transaction`SELECT orders.id, orders.agreed_total_minor, orders.status,
          (now() AT TIME ZONE organizations.timezone)::date::text AS today
        FROM orders JOIN organizations ON organizations.id = orders.organization_id
        WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${input.orderId} FOR UPDATE OF orders`;
      if (!order || order.status === "cancelled") throw new FinanceReferenceError("order");
      if (input.issuedOn > order.today) throw new FinanceFutureDateError();
      const [totals] = await transaction`SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'issued'), 0)::bigint AS invoiced_minor
        FROM order_invoices WHERE organization_id = ${member.organizationId} AND order_id = ${input.orderId}`;
      const available = BigInt(order.agreed_total_minor) - BigInt(totals.invoiced_minor);
      if (amountMinor > available) throw new FinanceAmountExceedsBalanceError(available);
      const [invoice] = await transaction`INSERT INTO order_invoices (
          organization_id, order_id, invoice_number, amount_minor, issued_on, due_on, note, idempotency_key, created_by
        ) VALUES (${member.organizationId}, ${input.orderId}, ${input.invoiceNumber}, ${amountMinor.toString()}, ${input.issuedOn},
          ${input.dueOn}, ${input.note}, ${input.idempotencyKey}, ${member.memberId}) RETURNING id`;
      const invoiceId = uuidSchema.parse(invoice.id);
      await transaction`UPDATE idempotency_requests SET entity_id = ${invoiceId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.invoice.create', 'order_invoice', ${invoiceId},
          ${transaction.json({ orderId: input.orderId, invoiceNumber: input.invoiceNumber, amountMinor: amountMinor.toString(), issuedOn: input.issuedOn, dueOn: input.dueOn })})`;
      return invoiceId;
    });
  } catch (error) {
    if (databaseConstraint(error) === "order_invoices_organization_id_invoice_number_key") throw new FinanceInvoiceNumberConflictError();
    throw error;
  }
}

export async function createPayment(member: AuthenticatedMember, input: CreatePaymentInput, receipt: FinanceReceiptFile | null = null) {
  requirePermission(member, "finance.write");
  if (receipt && receipt.documentId !== input.receiptDocumentId) throw new Error("Receipt document id does not match the request.");
  const amountMinor = parseMoneyToMinorUnits(input.amount);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'finance.payment.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!request.length) {
      const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existing?.operation !== "finance.payment.create" || !existing.entity_id) throw new FinanceRequestConflictError();
      return { id: uuidSchema.parse(existing.entity_id), created: false };
    }
    const [invoice] = await transaction`SELECT order_invoices.id, order_invoices.order_id, order_invoices.invoice_number,
        order_invoices.amount_minor, order_invoices.status, orders.client_id, orders.object_id,
        (now() AT TIME ZONE organizations.timezone)::date::text AS today
      FROM order_invoices JOIN organizations ON organizations.id = order_invoices.organization_id
      JOIN orders ON orders.organization_id = order_invoices.organization_id AND orders.id = order_invoices.order_id
      WHERE order_invoices.organization_id = ${member.organizationId} AND order_invoices.id = ${input.invoiceId} FOR UPDATE OF order_invoices`;
    if (!invoice || invoice.status !== "issued") throw new FinanceReferenceError("invoice");
    if (input.receivedOn > invoice.today) throw new FinanceFutureDateError();
    const [totals] = await transaction`SELECT coalesce(sum(amount_minor) FILTER (WHERE status = 'posted'), 0)::bigint AS paid_minor
      FROM order_payments WHERE organization_id = ${member.organizationId} AND invoice_id = ${input.invoiceId}`;
    const available = BigInt(invoice.amount_minor) - BigInt(totals.paid_minor);
    if (amountMinor > available) throw new FinanceAmountExceedsBalanceError(available);
    if (receipt) {
      await createReceiptDocument(transaction, member, receipt, {
        id: uuidSchema.parse(invoice.order_id),
        clientId: uuidSchema.parse(invoice.client_id),
        objectId: uuidSchema.parse(invoice.object_id),
      }, `Чек по счёту ${String(invoice.invoice_number)}`, `Подтверждение оплаты от ${input.receivedOn}.`);
    }
    const [payment] = await transaction`INSERT INTO order_payments (
        organization_id, order_id, invoice_id, amount_minor, received_on, payment_method, reference, note, receipt_document_id, idempotency_key, created_by
      ) VALUES (${member.organizationId}, ${invoice.order_id}, ${input.invoiceId}, ${amountMinor.toString()}, ${input.receivedOn},
        ${input.paymentMethod}, ${input.reference}, ${input.note}, ${receipt?.documentId ?? null}, ${input.idempotencyKey}, ${member.memberId}) RETURNING id`;
    const paymentId = uuidSchema.parse(payment.id);
    await transaction`UPDATE idempotency_requests SET entity_id = ${paymentId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.payment.create', 'order_payment', ${paymentId},
        ${transaction.json({ orderId: invoice.order_id, invoiceId: input.invoiceId, amountMinor: amountMinor.toString(), receivedOn: input.receivedOn, paymentMethod: input.paymentMethod })})`;
    return { id: paymentId, created: true };
  });
}

export async function createMasterPayout(member: AuthenticatedMember, input: CreatePayoutInput, receipt: FinanceReceiptFile | null = null) {
  requirePermission(member, "finance.write");
  if (receipt && receipt.documentId !== input.receiptDocumentId) throw new Error("Receipt document id does not match the request.");
  const amountMinor = parseMoneyToMinorUnits(input.amount);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const request = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'finance.payout.create')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
    if (!request.length) {
      const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existing?.operation !== "finance.payout.create" || !existing.entity_id) throw new FinanceRequestConflictError();
      return { id: uuidSchema.parse(existing.entity_id), created: false };
    }
    const [order] = await transaction`SELECT orders.id, orders.order_number, orders.client_id, orders.object_id, orders.assigned_master_id, orders.master_name_snapshot,
        orders.master_payment_snapshot_minor, orders.master_paid_total_minor,
        (now() AT TIME ZONE organizations.timezone)::date::text AS today
      FROM orders JOIN organizations ON organizations.id = orders.organization_id
      WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${input.orderId} FOR UPDATE OF orders`;
    if (!order) throw new FinanceReferenceError("order");
    if (!order.assigned_master_id || !order.master_name_snapshot || order.master_payment_snapshot_minor === null) throw new FinanceReferenceError("master");
    if (input.paidOn > order.today) throw new FinanceFutureDateError();
    const available = BigInt(order.master_payment_snapshot_minor) - BigInt(order.master_paid_total_minor);
    if (amountMinor > available) throw new FinanceAmountExceedsBalanceError(available);
    if (receipt) {
      await createReceiptDocument(transaction, member, receipt, {
        id: uuidSchema.parse(order.id),
        clientId: uuidSchema.parse(order.client_id),
        objectId: uuidSchema.parse(order.object_id),
      }, `Чек выплаты мастеру · ${String(order.order_number)}`, `Подтверждение выплаты ${String(order.master_name_snapshot)} от ${input.paidOn}.`);
    }
    const [payout] = await transaction`INSERT INTO order_master_payouts (
        organization_id, order_id, master_id, master_name_snapshot, amount_minor, paid_on, payment_method,
        reference, note, receipt_document_id, idempotency_key, created_by
      ) VALUES (${member.organizationId}, ${input.orderId}, ${order.assigned_master_id}, ${order.master_name_snapshot},
        ${amountMinor.toString()}, ${input.paidOn}, ${input.paymentMethod}, ${input.reference}, ${input.note},
        ${receipt?.documentId ?? null}, ${input.idempotencyKey}, ${member.memberId}) RETURNING id`;
    const payoutId = uuidSchema.parse(payout.id);
    await transaction`UPDATE idempotency_requests SET entity_id = ${payoutId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.payout.create', 'order_master_payout', ${payoutId},
        ${transaction.json({ orderId: input.orderId, masterId: order.assigned_master_id, amountMinor: amountMinor.toString(), paidOn: input.paidOn, paymentMethod: input.paymentMethod })})`;
    return { id: payoutId, created: true };
  });
}

export async function voidInvoice(member: AuthenticatedMember, input: VoidInvoiceInput) {
  requirePermission(member, "finance.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [invoice] = await transaction`SELECT id, order_id, invoice_number, amount_minor, status, version
      FROM order_invoices
      WHERE organization_id = ${member.organizationId} AND id = ${input.invoiceId}
      FOR UPDATE`;
    if (!invoice) throw new FinanceEntryNotFoundError();
    if (invoice.status !== "issued" || z.number().int().positive().parse(invoice.version) !== input.expectedVersion) throw new FinanceEntryConflictError();
    const [payments] = await transaction`SELECT count(*)::integer AS count FROM order_payments
      WHERE organization_id = ${member.organizationId} AND invoice_id = ${input.invoiceId} AND status = 'posted'`;
    if (z.number().int().nonnegative().parse(payments.count) > 0) throw new FinanceInvoiceHasPaymentsError();
    const [updated] = await transaction`UPDATE order_invoices SET status = 'void', void_reason = ${input.reason},
        voided_at = now(), voided_by = ${member.memberId}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.invoiceId}
      RETURNING version`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.invoice.void', 'order_invoice', ${input.invoiceId},
        ${transaction.json({ orderId: invoice.order_id, invoiceNumber: invoice.invoice_number, amountMinor: String(invoice.amount_minor), reason: input.reason, version: updated.version })})`;
    return z.number().int().positive().parse(updated.version);
  });
}

export async function reversePayment(member: AuthenticatedMember, input: ReverseLedgerEntryInput) {
  requirePermission(member, "finance.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [entry] = await transaction`UPDATE order_payments SET status = 'reversed', reversal_reason = ${input.reason},
        reversed_at = now(), reversed_by = ${member.memberId}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.entryId} AND version = ${input.expectedVersion} AND status = 'posted'
      RETURNING version, order_id, invoice_id, amount_minor`;
    if (!entry) {
      const [exists] = await transaction`SELECT id FROM order_payments WHERE organization_id = ${member.organizationId} AND id = ${input.entryId}`;
      if (!exists) throw new FinanceEntryNotFoundError();
      throw new FinanceEntryConflictError();
    }
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.payment.reverse', 'order_payment', ${input.entryId},
        ${transaction.json({ orderId: entry.order_id, invoiceId: entry.invoice_id, amountMinor: String(entry.amount_minor), reason: input.reason, version: entry.version })})`;
    return z.number().int().positive().parse(entry.version);
  });
}

export async function reverseMasterPayout(member: AuthenticatedMember, input: ReverseLedgerEntryInput) {
  requirePermission(member, "finance.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [entry] = await transaction`UPDATE order_master_payouts SET status = 'reversed', reversal_reason = ${input.reason},
        reversed_at = now(), reversed_by = ${member.memberId}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.entryId} AND version = ${input.expectedVersion} AND status = 'posted'
      RETURNING version, order_id, master_id, amount_minor`;
    if (!entry) {
      const [exists] = await transaction`SELECT id FROM order_master_payouts WHERE organization_id = ${member.organizationId} AND id = ${input.entryId}`;
      if (!exists) throw new FinanceEntryNotFoundError();
      throw new FinanceEntryConflictError();
    }
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'finance.payout.reverse', 'order_master_payout', ${input.entryId},
        ${transaction.json({ orderId: entry.order_id, masterId: entry.master_id, amountMinor: String(entry.amount_minor), reason: input.reason, version: entry.version })})`;
    return z.number().int().positive().parse(entry.version);
  });
}
