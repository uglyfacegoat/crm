import { z } from "zod";
import { orderCopyDateOverrideSchema } from "../orders/schemas.ts";
import { visitStatuses } from "./types.ts";

const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const rescheduleReason = z.string().trim().min(3, "Укажите причину переноса").max(1_000, "Причина переноса слишком длинная");
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ");
const arrivalMode = z.enum(["fixed", "window"]);
const optionalEndTime = z.union([z.literal(""), localTime]).optional().transform((value) => value || null);

function validateArrivalWindow(value: { arrivalMode?: "fixed" | "window"; localTime: string; endTime?: string | null }, context: z.RefinementCtx) {
  if (value.arrivalMode === "window" && !value.endTime) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "Укажите окончание интервала" });
  }
  if (value.arrivalMode === "window" && value.endTime === value.localTime) {
    context.addIssue({ code: "custom", path: ["endTime"], message: "Окончание интервала должно отличаться от начала" });
  }
}

export const createVisitSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  localDate: z.iso.date("Укажите дату выезда"),
  localTime,
  arrivalMode: arrivalMode.optional(),
  endTime: optionalEndTime,
  durationMinutes: z.coerce.number().int().min(15, "Минимальная длительность — 15 минут").max(1_440, "Максимальная длительность — 24 часа"),
  assignedMasterId: optionalUuid,
  notes: optionalText(4_000),
}).superRefine(validateArrivalWindow);

export const createVisitSeriesSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  expectedOrderVersion: z.coerce.number().int().positive().optional(),
  dateOverrides: z.array(orderCopyDateOverrideSchema.pick({ date: true, assignedMasterId: true, masterPayment: true, serviceIds: true, serviceChanges: true, extraServices: true, visitNotes: true, arrivalMode: true, startTime: true, endTime: true })).max(60).default([]),
  scheduleMode: z.enum(["interval", "dates"]).default("interval"),
  selectedDates: z.array(z.iso.date()).max(60).default([]),
  startsOn: z.iso.date("Укажите дату первого выезда"),
  endsOn: z.iso.date("Укажите дату окончания серии"),
  localTime,
  arrivalMode: arrivalMode.optional(),
  endTime: optionalEndTime,
  durationMinutes: z.coerce.number().int().min(15, "Минимальная длительность — 15 минут").max(1_440, "Максимальная длительность — 24 часа"),
  frequencyUnit: z.enum(["week", "month"]),
  frequencyInterval: z.coerce.number().int().min(1).max(12),
  assignedMasterId: optionalUuid,
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  validateArrivalWindow(value, context);
  if (value.scheduleMode === "dates") {
    if (!value.selectedDates.length) context.addIssue({ code: "custom", path: ["selectedDates"], message: "Выберите хотя бы одну дату" });
    if (new Set(value.selectedDates).size !== value.selectedDates.length) context.addIssue({ code: "custom", path: ["selectedDates"], message: "Одна дата выбрана несколько раз" });
    if (value.selectedDates.some((date) => date < value.startsOn || date > value.endsOn)) context.addIssue({ code: "custom", path: ["selectedDates"], message: "Дата вне периода серии" });
  }
  if (new Set(value.dateOverrides.map(entry => entry.date)).size !== value.dateOverrides.length) context.addIssue({ code: "custom", path: ["dateOverrides"], message: "Настройки даты указаны дважды" });
  for (const [index, override] of value.dateOverrides.entries()) {
    if (override.date < value.startsOn || override.date > value.endsOn || value.scheduleMode === "dates" && !value.selectedDates.includes(override.date)) context.addIssue({ code: "custom", path: ["dateOverrides", index], message: "Дата не входит в серию" });
    validateArrivalWindow({ arrivalMode: override.arrivalMode ?? value.arrivalMode, localTime: override.startTime ?? value.localTime, endTime: override.endTime ?? value.endTime }, context);
    if (override.assignedMasterId === null && override.masterPayment) context.addIssue({ code: "custom", path: ["dateOverrides", index], message: "Для выплаты выберите мастера" });
  }
  const startsAt = Date.parse(`${value.startsOn}T00:00:00Z`);
  const endsAt = Date.parse(`${value.endsOn}T00:00:00Z`);
  if (endsAt < startsAt) context.addIssue({ code: "custom", path: ["endsOn"], message: "Окончание серии не может быть раньше начала" });
  if (endsAt > startsAt + 366 * 86_400_000) context.addIssue({ code: "custom", path: ["endsOn"], message: "Серию можно создать максимум на год" });
});

export const updateVisitSchema = z.object({
  visitId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  localDate: z.iso.date("Укажите дату выезда"),
  localTime,
  arrivalMode: arrivalMode.optional(),
  endTime: optionalEndTime,
  durationMinutes: z.coerce.number().int().min(15).max(1_440),
  status: z.enum(visitStatuses),
  assignedMasterId: optionalUuid,
  cancellationReason: optionalText(1_000),
  rescheduleReason: optionalText(1_000),
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  validateArrivalWindow(value, context);
  if (value.status === "completed") {
    context.addIssue({ code: "custom", path: ["status"], message: "Завершите выезд через загрузку закрывающего акта" });
  }
  if (value.status === "cancelled" && (!value.cancellationReason || value.cancellationReason.length < 3)) {
    context.addIssue({ code: "custom", path: ["cancellationReason"], message: "Укажите причину отмены" });
  }
});

export const completeVisitSchema = z.object({
  idempotencyKey: z.string().uuid(),
  visitId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  actTitle: z.string().trim().min(2, "Укажите название акта").max(240),
  completionNotes: z.string().trim().min(3, "Кратко опишите результат работ").max(4_000),
});

export const startVisitSchema = z.object({
  visitId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
});

export const uploadVisitEvidenceSchema = z.object({
  idempotencyKey: z.string().uuid(),
  visitId: z.string().uuid(),
  kind: z.enum(["work_photo", "contract_photo"]),
  note: optionalText(1_000),
});

export const rescheduleVisitSchema = z.object({
  visitId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  localDate: z.iso.date("Укажите дату выезда"),
  localTime,
  arrivalMode: arrivalMode.optional(),
  endTime: optionalEndTime,
  rescheduleReason,
}).superRefine(validateArrivalWindow);

export const visitIdSchema = z.string().uuid();
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type CreateVisitSeriesInput = z.infer<typeof createVisitSeriesSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
export type CompleteVisitInput = z.infer<typeof completeVisitSchema>;
export type StartVisitInput = z.infer<typeof startVisitSchema>;
export type UploadVisitEvidenceInput = z.infer<typeof uploadVisitEvidenceSchema>;
export type RescheduleVisitInput = z.infer<typeof rescheduleVisitSchema>;
