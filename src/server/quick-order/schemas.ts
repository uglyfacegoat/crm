import { z } from "zod";
import { isValidContactPhone } from "../clients/phone.ts";
import { parseMoneyToMinorUnits } from "../orders/money.ts";
import { orderExpenseInputSchema, orderServiceInputSchema } from "../orders/schemas.ts";

const optionalEmail = z.union([z.literal(""), z.string().trim().email().max(254)]).transform((value) => value || null);
const optionalTaxId = z.union([z.literal(""), z.string().trim().regex(/^\d{10}(\d{2})?$/, "ИНН должен содержать 10 или 12 цифр")]).transform((value) => value || null);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().transform((value) => value || null);
const optionalUuid = z.union([z.literal(""), z.string().uuid()]).transform((value) => value || null);
const contactPhone = z.string().trim().min(7, "Введите телефон").max(40).refine(isValidContactPhone, "Телефон должен содержать от 10 до 15 цифр");
const money = z.string().trim().refine((value) => {
  try {
    parseMoneyToMinorUnits(value);
    return true;
  } catch {
    return false;
  }
}, "Укажите сумму в рублях, не более двух знаков после запятой");
const optionalPositiveNumber = z.union([z.literal(""), z.coerce.number().positive().max(10_000_000)]).transform((value) => value === "" ? null : value);
const optionalPositiveInteger = z.union([z.literal(""), z.coerce.number().int().positive().max(1_000)]).transform((value) => value === "" ? null : value);

const newContactSchema = z.object({
  fullName: z.string().trim().min(2, "Введите имя контактного лица").max(200),
  position: optionalText(120),
  phone: contactPhone,
  email: optionalEmail,
});

const newObjectSchema = z.object({
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

const newClientSchema = z.object({
  mode: z.literal("new"),
  details: z.object({
    kind: z.enum(["legal_entity", "individual"]),
    legalName: z.string().trim().min(2, "Введите название или ФИО").max(300),
    taxId: optionalTaxId,
    contactName: z.string().trim().min(2, "Введите имя контактного лица").max(200),
    contactPosition: optionalText(120),
    phone: contactPhone,
    email: optionalEmail,
  }).superRefine((value, context) => {
    if (value.kind === "legal_entity" && !value.taxId) {
      context.addIssue({ code: "custom", path: ["taxId"], message: "Для юридического лица укажите ИНН" });
    }
  }),
  object: newObjectSchema,
});

const existingClientSchema = z.object({
  mode: z.literal("existing"),
  clientId: z.string().uuid(),
  contact: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), contactId: z.string().uuid() }),
    z.object({ mode: z.literal("new"), details: newContactSchema }),
  ]),
  object: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("existing"), objectId: z.string().uuid() }),
    z.object({ mode: z.literal("new"), details: newObjectSchema }),
  ]),
});

const quickOrderDetailsSchema = z.object({
  assignedMasterId: optionalUuid,
  masterPayment: z.union([z.literal(""), money]).transform((value) => value || null),
  notes: optionalText(4_000),
  services: z.array(orderServiceInputSchema).min(1, "Добавьте хотя бы одну услугу").max(100),
  expenses: z.array(orderExpenseInputSchema).max(100),
});

const quickVisitSchema = z.object({
  localDate: z.iso.date("Укажите дату выезда"),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Укажите время в формате ЧЧ:ММ"),
  durationMinutes: z.coerce.number().int().min(15, "Минимальная длительность — 15 минут").max(1_440, "Максимальная длительность — 24 часа"),
  assignedMasterId: optionalUuid,
  notes: optionalText(4_000),
});

export const quickOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  client: z.discriminatedUnion("mode", [newClientSchema, existingClientSchema]),
  order: quickOrderDetailsSchema,
  visit: quickVisitSchema,
}).superRefine((value, context) => {
  if (value.order.assignedMasterId && value.order.masterPayment === null) {
    context.addIssue({ code: "custom", path: ["order", "masterPayment"], message: "Укажите выплату назначенному мастеру" });
  }
  if (!value.order.assignedMasterId && value.order.masterPayment !== null) {
    context.addIssue({ code: "custom", path: ["order", "assignedMasterId"], message: "Сначала назначьте мастера" });
  }
  if (value.order.assignedMasterId !== value.visit.assignedMasterId) {
    context.addIssue({ code: "custom", path: ["visit", "assignedMasterId"], message: "Мастер заказа и первого выезда должен совпадать" });
  }
});

export type QuickOrderInput = z.infer<typeof quickOrderSchema>;
