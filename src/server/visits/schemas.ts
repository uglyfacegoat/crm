import { z } from "zod";
import { visitStatuses } from "./types.ts";

const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ");

export const createVisitSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  localDate: z.iso.date("Укажите дату выезда"),
  localTime,
  durationMinutes: z.coerce.number().int().min(15, "Минимальная длительность — 15 минут").max(1_440, "Максимальная длительность — 24 часа"),
  assignedMasterId: optionalUuid,
  notes: optionalText(4_000),
});

export const createVisitSeriesSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  startsOn: z.iso.date("Укажите дату первого выезда"),
  endsOn: z.iso.date("Укажите дату окончания серии"),
  localTime,
  durationMinutes: z.coerce.number().int().min(15, "Минимальная длительность — 15 минут").max(1_440, "Максимальная длительность — 24 часа"),
  frequencyUnit: z.enum(["week", "month"]),
  frequencyInterval: z.coerce.number().int().min(1).max(12),
  assignedMasterId: optionalUuid,
  notes: optionalText(4_000),
}).superRefine((value, context) => {
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
  durationMinutes: z.coerce.number().int().min(15).max(1_440),
  status: z.enum(visitStatuses),
  assignedMasterId: optionalUuid,
  cancellationReason: optionalText(1_000),
  notes: optionalText(4_000),
}).superRefine((value, context) => {
  if (value.status === "cancelled" && (!value.cancellationReason || value.cancellationReason.length < 3)) {
    context.addIssue({ code: "custom", path: ["cancellationReason"], message: "Укажите причину отмены" });
  }
});

export const rescheduleVisitSchema = z.object({
  visitId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  localDate: z.iso.date("Укажите дату выезда"),
  localTime,
});

export const visitIdSchema = z.string().uuid();
export type CreateVisitInput = z.infer<typeof createVisitSchema>;
export type CreateVisitSeriesInput = z.infer<typeof createVisitSeriesSchema>;
export type UpdateVisitInput = z.infer<typeof updateVisitSchema>;
export type RescheduleVisitInput = z.infer<typeof rescheduleVisitSchema>;
