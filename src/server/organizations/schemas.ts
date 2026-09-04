import { z } from "zod";

export const createOrganizationSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2, "Введите название компании").max(200),
  timezone: z.enum(["Europe/Moscow", "Europe/Kaliningrad", "Europe/Samara", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"]),
});

export const switchOrganizationSchema = z.object({ organizationId: z.string().uuid() });

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

