import assert from "node:assert/strict";
import test from "node:test";
import { createInvoiceSchema, createPaymentSchema, createPayoutSchema, reverseLedgerEntrySchema, voidInvoiceSchema } from "./schemas.ts";

const id = "ed0a2a49-51e4-40a4-9c1c-5207b61cf7c4";
test("invoice requires a positive amount and ordered dates", () => {
  const input = { idempotencyKey: id, orderId: id, invoiceNumber: "СЧ-104", amount: "12 500,50", issuedOn: "2026-08-31", dueOn: "2026-09-07", note: "" };
  assert.equal(createInvoiceSchema.safeParse(input).success, true);
  assert.equal(createInvoiceSchema.safeParse({ ...input, dueOn: "2026-08-30" }).success, false);
  assert.equal(createInvoiceSchema.safeParse({ ...input, amount: "0" }).success, false);
});

test("client payments and master payouts require explicit ledger metadata", () => {
  const payment = { idempotencyKey: id, receiptDocumentId: id, invoiceId: id, amount: "5000", receivedOn: "2026-08-31", paymentMethod: "bank_transfer", reference: "ПП-18", note: "" };
  assert.equal(createPaymentSchema.safeParse(payment).success, true);
  assert.equal(createPaymentSchema.safeParse({ ...payment, paymentMethod: "crypto" }).success, false);
  assert.equal(createPayoutSchema.safeParse({ ...payment, orderId: id, paidOn: payment.receivedOn }).success, true);
});

test("ledger reversal is versioned and requires a reason", () => {
  assert.equal(reverseLedgerEntrySchema.safeParse({ entryId: id, expectedVersion: 2, reason: "Ошибочно выбран счёт" }).success, true);
  assert.equal(reverseLedgerEntrySchema.safeParse({ entryId: id, expectedVersion: 0, reason: "" }).success, false);
});

test("invoice void is versioned and requires a reason", () => {
  assert.equal(voidInvoiceSchema.safeParse({ invoiceId: id, expectedVersion: 1, reason: "Ошибка в сумме" }).success, true);
  assert.equal(voidInvoiceSchema.safeParse({ invoiceId: id, expectedVersion: 1, reason: "x" }).success, false);
});
