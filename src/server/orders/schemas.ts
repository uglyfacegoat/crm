import { z } from "zod";
import { parseMoneyToMinorUnits, parseQuantityToMilliunits } from "./money.ts";
import { orderStatuses } from "./types.ts";

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
  catalogItemId: z.string().uuid().nullable().optional(),
  existingLineId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2, "Введите название услуги").max(200),
  quantity,
  unitPrice: money,
  note: optionalText(1_000),
});

const editableOrderServiceInputSchema = orderServiceInputSchema.extend({
  unitPrice: z.union([z.literal(""), money]),
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
  masterPayment: z.union([z.literal(""), z.literal("preserve"), money]).transform((value) => value || null),
  notes: optionalText(4_000),
  agreedTotal: money,
  services: z.array(editableOrderServiceInputSchema).max(100),
}).superRefine((value, context) => {
  if (value.status === "cancelled" && (!value.statusReason || value.statusReason.length < 3)) {
    context.addIssue({ code: "custom", path: ["statusReason"], message: "Укажите причину отмены" });
  }
  if (value.assignedMasterId && value.masterPayment === null) {
    context.addIssue({ code: "custom", path: ["masterPayment"], message: "Укажите выплату назначенному мастеру" });
  }
  if (!value.assignedMasterId && value.masterPayment !== null && value.masterPayment !== "preserve") {
    context.addIssue({ code: "custom", path: ["assignedMasterId"], message: "Сначала назначьте мастера" });
  }
});

export const completeOrderLinksSchema = z.object({
  orderId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  objectId: optionalUuid,
  contactId: optionalUuid,
});

export const addOrderExpenseSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  category: z.string().trim().min(2, "Введите категорию расхода").max(80),
  amount: positiveMoney,
  occurredOn: z.iso.date("Укажите дату расхода"),
  note: optionalText(1_000),
});

const uniqueUuidList = (maximum: number) => z.array(z.string().uuid()).max(maximum).refine(
  (values) => new Set(values).size === values.length,
  "Один элемент выбран несколько раз",
);

export const orderCopyDateOverrideSchema = z.object({
    date: z.iso.date(),
    assignedMasterId: z.string().uuid().nullable().optional(),
    masterPayment: z.string().trim().regex(/^\d{1,11}(?:[.,]\d{1,2})?$/).nullable().optional(),
    serviceIds: uniqueUuidList(100).optional(),
    serviceChanges: z.array(z.object({
      id: z.string().uuid(),
      quantity,
      unitPrice: z.union([z.literal(""), money]),
    })).max(100).refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, "Одна услуга изменена дважды").optional(),
    expenseIds: uniqueUuidList(100).optional(),
    extraServices: z.array(z.object({
      catalogItemId: z.string().uuid().nullable().optional(),
      name: z.string().trim().min(2).max(200),
      kind: z.enum(["service", "product"]),
      unit: z.string().trim().min(1).max(40),
      quantity: z.coerce.number().positive().max(1_000_000),
      unitPrice: z.coerce.string().trim().regex(/^(?:\d{1,11}(?:[.,]\d{1,2})?)?$/),
    })).max(20).optional(),
    notes: z.string().trim().max(4_000).nullable().optional(),
    visitNotes: z.string().trim().max(4_000).nullable().optional(),
    arrivalMode: z.enum(["fixed", "window"]).optional(),
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
  });

export const copyOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sourceOrderId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  copyDate: z.iso.date("Укажите дату новой копии"),
  copyDates: z.array(z.iso.date()).max(24, "За один раз можно создать до 24 копий").default([]),
  dateOverrides: z.array(orderCopyDateOverrideSchema).max(24).default([]),
  serviceIds: uniqueUuidList(100),
  expenseIds: uniqueUuidList(100),
  visitIds: uniqueUuidList(100),
  copyContact: z.boolean().default(true),
  copyRelatedObjects: z.boolean().default(true),
  copyMaster: z.boolean(),
  copyNotes: z.boolean(),
}).superRefine((value, context) => {
  if (new Set(value.copyDates).size !== value.copyDates.length) context.addIssue({ code: "custom", path: ["copyDates"], message: "Одна дата выбрана несколько раз" });
  if (value.copyDates.length && !value.copyDates.includes(value.copyDate)) context.addIssue({ code: "custom", path: ["copyDate"], message: "Первая дата должна быть выбрана в календаре" });
  const sortedDates = [...value.copyDates].sort();
  if (sortedDates.length && sortedDates.at(-1)! > new Date(Date.parse(`${sortedDates[0]}T00:00:00Z`) + 366 * 86_400_000).toISOString().slice(0, 10)) context.addIssue({ code: "custom", path: ["copyDates"], message: "Выбирайте даты в пределах одного года" });
  const selectedDates = value.copyDates.length ? value.copyDates : [value.copyDate];
  if (new Set(value.dateOverrides.map((entry) => entry.date)).size !== value.dateOverrides.length) context.addIssue({ code: "custom", path: ["dateOverrides"], message: "Настройки одной даты заданы дважды" });
  for (const [index, override] of value.dateOverrides.entries()) {
    if (!selectedDates.includes(override.date)) context.addIssue({ code: "custom", path: ["dateOverrides", index, "date"], message: "Дата не входит в серию" });
    if (override.arrivalMode === "fixed" && !override.startTime) context.addIssue({ code: "custom", path: ["dateOverrides", index, "startTime"], message: "Укажите точное время" });
    if (override.arrivalMode === "window" && (!override.startTime || !override.endTime)) context.addIssue({ code: "custom", path: ["dateOverrides", index], message: "Укажите начало и конец интервала" });
    if (override.arrivalMode !== "fixed" && Boolean(override.startTime) !== Boolean(override.endTime)) context.addIssue({ code: "custom", path: ["dateOverrides", index], message: "Укажите начало и конец интервала" });
    if (override.startTime && override.endTime && override.startTime === override.endTime) context.addIssue({ code: "custom", path: ["dateOverrides", index], message: "Начало и конец интервала должны различаться" });
    if (override.assignedMasterId === null && override.masterPayment) context.addIssue({ code: "custom", path: ["dateOverrides", index, "masterPayment"], message: "Для выплаты выберите мастера" });
  }
});

export const orderIdSchema = z.string().uuid();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddOrderExpenseInput = z.infer<typeof addOrderExpenseSchema>;
export type CopyOrderInput = z.infer<typeof copyOrderSchema>;
