import { z } from "zod";
import { parseMoneyToMinorUnits, parseQuantityToMilliunits } from "./money";
import { orderStatuses } from "./types";

const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const money = z.string().trim().refine((value) => {
  try {
    parseMoneyToMinorUnits(value);
    return true;
  } catch {
    return false;
  }
}, "Укажите сумму в рублях, не более двух знаков после запятой");
const positiveMoney = z.string().trim().refine((value) => {
  try {
    return parseMoneyToMinorUnits(value) > 0n;
  } catch {
    return false;
  }
}, "Сумма должна быть больше нуля");
const quantity = z.string().trim().refine((value) => {
  try {
    parseQuantityToMilliunits(value);
    return true;
  } catch {
    return false;
  }
}, "Количество должно быть больше нуля, не более трёх знаков после запятой");

export const orderServiceInputSchema = z.object({
  name: z.string().trim().min(2, "Введите название услуги").max(200),
  quantity,
  unitPrice: money,
  note: optionalText(1_000),
});

export const orderExpenseInputSchema = z.object({
  category: z.string().trim().min(2, "Введите категорию расхода").max(80),
  amount: positiveMoney,
  occurredOn: z.iso.date("Укажите дату расхода"),
  note: optionalText(1_000),
});

export const createOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientId: z.string().uuid(),
  objectId: z.string().uuid(),
  contactId: z.string().uuid(),
  assignedMasterId: optionalUuid,
  masterPayment: z.union([z.literal(""), money]).transform((value) => value || null),
  notes: optionalText(4_000),
  services: z.array(orderServiceInputSchema).min(1, "Добавьте хотя бы одну услугу").max(100),
  expenses: z.array(orderExpenseInputSchema).max(100),
}).superRefine((value, context) => {
  if (value.assignedMasterId && value.masterPayment === null) {
    context.addIssue({ code: "custom", path: ["masterPayment"], message: "Укажите выплату назначенному мастеру" });
  }
  if (!value.assignedMasterId && value.masterPayment !== null) {
    context.addIssue({ code: "custom", path: ["assignedMasterId"], message: "Сначала назначьте мастера" });
  }
});

export const updateOrderSchema = z.object({
  orderId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(orderStatuses),
  statusReason: optionalText(1_000),
  assignedMasterId: optionalUuid,
  masterPayment: z.union([z.literal(""), money]).transform((value) => value || null),
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  if (value.status === "cancelled" && (!value.statusReason || value.statusReason.length < 3)) {
    context.addIssue({ code: "custom", path: ["statusReason"], message: "Укажите причину отмены" });
  }
  if (value.assignedMasterId && value.masterPayment === null) {
    context.addIssue({ code: "custom", path: ["masterPayment"], message: "Укажите выплату назначенному мастеру" });
  }
  if (!value.assignedMasterId && value.masterPayment !== null) {
    context.addIssue({ code: "custom", path: ["assignedMasterId"], message: "Сначала назначьте мастера" });
  }
});

export const addOrderExpenseSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  category: z.string().trim().min(2, "Введите категорию расхода").max(80),
  amount: positiveMoney,
  occurredOn: z.iso.date("Укажите дату расхода"),
  note: optionalText(1_000),
});

export const orderIdSchema = z.string().uuid();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddOrderExpenseInput = z.infer<typeof addOrderExpenseSchema>;
