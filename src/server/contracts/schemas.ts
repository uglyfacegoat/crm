import { z } from "zod";
import { contractStatuses } from "./types.ts";

const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ");

const periodFields = {
  startsOn: z.iso.date("Укажите дату начала"),
  endsOn: z.iso.date("Укажите дату окончания"),
};

const scheduleFields = {
  scheduleEnabled: z.boolean(),
  frequencyUnit: z.enum(["week", "month"]),
  frequencyInterval: z.coerce.number().int().min(1).max(12),
  localTime,
  durationMinutes: z.coerce.number().int().min(15).max(1_440),
  defaultMasterId: optionalUuid,
};

function validatePeriod(value: { startsOn: string; endsOn: string }, context: z.RefinementCtx) {
  const start = Date.parse(`${value.startsOn}T00:00:00Z`);
  const end = Date.parse(`${value.endsOn}T00:00:00Z`);
  if (end < start) context.addIssue({ code: "custom", path: ["endsOn"], message: "Окончание не может быть раньше начала" });
  if (end > start + 366 * 86_400_000) context.addIssue({ code: "custom", path: ["endsOn"], message: "Один период договора может длиться не более года" });
}

export const createContractSchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientId: z.string().uuid(),
  objectId: z.string().uuid(),
  contractNumber: z.string().trim().min(1, "Укажите номер договора").max(120),
  status: z.enum(["draft", "active"]),
  ...periodFields,
  renewalNoticeDays: z.coerce.number().int().min(1).max(365),
  notes: optionalText(4_000),
  ...scheduleFields,
}).superRefine(validatePeriod);

export const updateContractSchema = z.object({
  contractId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  contractNumber: z.string().trim().min(1).max(120),
  status: z.enum(contractStatuses),
  ...periodFields,
  renewalNoticeDays: z.coerce.number().int().min(1).max(365),
  notes: optionalText(4_000),
  reason: optionalText(1_000),
}).superRefine(validatePeriod);

export const renewContractSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sourceContractId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  contractNumber: z.string().trim().min(1).max(120),
  ...periodFields,
  renewalNoticeDays: z.coerce.number().int().min(1).max(365),
  copySchedule: z.boolean(),
}).superRefine(validatePeriod);

export const contractIdSchema = z.string().uuid();
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type UpdateContractInput = z.infer<typeof updateContractSchema>;
export type RenewContractInput = z.infer<typeof renewContractSchema>;
