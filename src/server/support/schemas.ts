import { z } from "zod";

export const supportRequestStatuses = [
  "new",
  "in_progress",
  "resolved",
  "closed",
] as const;

export const createSupportRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  category: z.enum(["usability", "data", "access", "technical"]),
  subject: z.string().trim().min(5, "Опишите тему чуть подробнее").max(200),
  description: z.string().trim().min(20, "Добавьте шаги и ожидаемый результат").max(4000),
});

export const updateSupportRequestStatusSchema = z.object({
  requestId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  status: z.enum(supportRequestStatuses),
});

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;
export type UpdateSupportRequestStatusInput = z.infer<
  typeof updateSupportRequestStatusSchema
>;
