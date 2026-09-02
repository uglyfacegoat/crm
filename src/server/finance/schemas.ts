import { z } from "zod";
import { parseMoneyToMinorUnits } from "../orders/money.ts";
import { paymentMethods } from "./types.ts";

const positiveMoney = z.string().trim().refine((value) => {
  try { return parseMoneyToMinorUnits(value) > 0n; } catch { return false; }
}, "Сумма должна быть больше нуля, не более двух знаков после запятой");
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);

export const createInvoiceSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1, "Укажите номер счёта").max(120),
  amount: positiveMoney,
  issuedOn: z.iso.date("Укажите дату выставления"),
  dueOn: z.iso.date("Укажите срок оплаты"),
  note: optionalText(2_000),
}).superRefine((value, context) => {
  if (value.dueOn < value.issuedOn) context.addIssue({ code: "custom", path: ["dueOn"], message: "Срок оплаты не может быть раньше даты счёта" });
});

export const createPaymentSchema = z.object({
  idempotencyKey: z.string().uuid(),
  invoiceId: z.string().uuid(),
  amount: positiveMoney,
  receivedOn: z.iso.date("Укажите дату оплаты"),
  paymentMethod: z.enum(paymentMethods),
  reference: optionalText(200),
  note: optionalText(2_000),
});

export const createPayoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  amount: positiveMoney,
  paidOn: z.iso.date("Укажите дату выплаты"),
  paymentMethod: z.enum(paymentMethods),
  reference: optionalText(200),
  note: optionalText(2_000),
});

export const reverseLedgerEntrySchema = z.object({
  entryId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, "Укажите причину сторно").max(1_000),
});

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().min(3, "Укажите причину аннулирования").max(1_000),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;
export type ReverseLedgerEntryInput = z.infer<typeof reverseLedgerEntrySchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
