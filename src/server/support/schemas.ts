import { z } from "zod";

export const createSupportRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  category: z.enum(["usability", "data", "access", "technical"]),
  subject: z.string().trim().min(5, "Опишите тему чуть подробнее").max(200),
  description: z.string().trim().min(20, "Добавьте шаги и ожидаемый результат").max(4000),
});

export type CreateSupportRequestInput = z.infer<typeof createSupportRequestSchema>;
