import { z } from "zod";

export const createOrganizationSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2, "Введите название компании").max(200),
  timezone: z.enum([
    "Europe/Moscow",
    "Europe/Kaliningrad",
    "Europe/Samara",
    "Asia/Yekaterinburg",
    "Asia/Novosibirsk",
    "Asia/Vladivostok",
  ]),
});

export const switchOrganizationSchema = z.object({
  organizationId: z.string().uuid(),
});

export const createOrganizationUnitSchema = z
  .object({
    organizationId: z.string().uuid(),
    parentUnitId: z.preprocess(
      (value) => (value == null || value === "" ? null : value),
      z.string().uuid().nullable(),
    ),
    kind: z.enum(["city", "area"]),
    name: z.string().trim().min(2, "Укажите название").max(120),
    address: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().max(300).nullable(),
    ),
  })
  .refine(
    (value) =>
      (value.kind === "city" && value.parentUnitId === null) ||
      (value.kind === "area" && value.parentUnitId !== null),
    { path: ["parentUnitId"], message: "Для района необходимо выбрать город." },
  );

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateOrganizationUnitInput = z.infer<
  typeof createOrganizationUnitSchema
>;
