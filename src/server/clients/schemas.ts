import { z } from "zod";
import { isValidContactPhone } from "./phone";

const optionalEmail = z.union([z.literal(""), z.string().trim().email().max(254)]).transform((value) => value || null);
const optionalTaxId = z.union([z.literal(""), z.string().trim().regex(/^\d{10}(\d{2})?$/, "ИНН должен содержать 10 или 12 цифр")]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const contactPhone = z.string().trim().min(7, "Введите телефон").max(40).refine(isValidContactPhone, "Телефон должен содержать от 10 до 15 цифр");
const optionalPositiveNumber = z.union([z.literal(""), z.coerce.number().positive("Значение должно быть больше нуля").max(10_000_000)]).transform((value) => value === "" ? null : value);
const optionalPositiveInteger = z.union([z.literal(""), z.coerce.number().int().positive("Значение должно быть больше нуля").max(1_000)]).transform((value) => value === "" ? null : value);

export const createClientSchema = z.object({
  idempotencyKey: z.string().uuid(),
  kind: z.enum(["legal_entity", "individual"]),
  legalName: z.string().trim().min(2, "Введите название или ФИО").max(300),
  taxId: optionalTaxId,
  contactName: z.string().trim().min(2, "Введите имя контактного лица").max(200),
  contactPosition: z.string().trim().max(120).optional().transform((value) => value || null),
  phone: contactPhone,
  email: optionalEmail,
}).superRefine((value, context) => {
  if (value.kind === "legal_entity" && !value.taxId) context.addIssue({ code: "custom", path: ["taxId"], message: "Для юридического лица укажите ИНН" });
});

export type CreateClientInput = z.infer<typeof createClientSchema>;

export const clientIdSchema = z.string().uuid();

export const updateClientSchema = z.object({
  clientId: clientIdSchema,
  expectedVersion: z.coerce.number().int().positive(),
  kind: z.enum(["legal_entity", "individual"]),
  legalName: z.string().trim().min(2, "Введите название или ФИО").max(300),
  taxId: optionalTaxId,
}).superRefine((value, context) => {
  if (value.kind === "legal_entity" && !value.taxId) context.addIssue({ code: "custom", path: ["taxId"], message: "Для юридического лица укажите ИНН" });
});

export const createClientContactSchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientId: clientIdSchema,
  fullName: z.string().trim().min(2, "Введите имя контактного лица").max(200),
  position: optionalText(120),
  phone: contactPhone,
  email: optionalEmail,
  isPrimary: z.boolean(),
});

export const createClientObjectSchema = z.object({
  idempotencyKey: z.string().uuid(),
  clientId: clientIdSchema,
  name: z.string().trim().min(2, "Введите название объекта").max(240),
  objectType: z.string().trim().min(2, "Укажите тип объекта").max(100),
  address: z.string().trim().min(5, "Введите полный адрес").max(500),
  areaSquareMeters: optionalPositiveNumber,
  floorCount: optionalPositiveInteger,
  onsiteContact: optionalText(300),
  accessInstructions: optionalText(2_000),
  parkingNotes: optionalText(1_000),
  restrictions: optionalText(2_000),
  riskLevel: z.coerce.number().int().min(1).max(5),
  infestationLevel: z.coerce.number().int().min(0).max(5),
});

export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type CreateClientContactInput = z.infer<typeof createClientContactSchema>;
export type CreateClientObjectInput = z.infer<typeof createClientObjectSchema>;
