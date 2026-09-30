import { z } from "zod";
import { isValidContactPhone } from "../clients/phone.ts";
import { parseMoneyToMinorUnits, parseQuantityToMilliunits } from "../orders/money.ts";

const optionalPhone = z.string().trim().max(40).refine((value) => !value || isValidContactPhone(value), "Проверьте номер телефона").default("");
const optionalEmail = z.string().trim().max(254).refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Проверьте email").default("").transform((value) => value.toLowerCase());
const optionalMoney = z.string().trim().refine((value) => { if (!value) return true; try { parseMoneyToMinorUnits(value); return true; } catch { return false; } }, "Укажите корректную сумму").default("");
const phone = z.object({ label: z.string().trim().max(80).default(""), phone: z.string().trim().max(40).refine(isValidContactPhone, "Проверьте номер телефона") });
const contact = z.object({ name: z.string().trim().min(2, "Укажите имя контакта").max(200), position: z.string().trim().max(120).default(""), phone: optionalPhone, email: optionalEmail, phones: z.array(phone).max(10).default([]) });
const object = z.object({
  name: z.string().trim().max(240).default(""),
  objectType: z.string().trim().max(100).default(""),
  address: z.string().trim().max(500).refine((value) => !value || value.length >= 5, "Укажите полный адрес или оставьте поле пустым").default(""),
  areaSquareMeters: z.string().trim().refine((value) => !value || /^\d{1,10}(?:[.,]\d{1,2})?$/.test(value), "Проверьте площадь").default(""),
  floorCount: z.string().trim().refine((value) => !value || /^\d{1,3}$/.test(value), "Проверьте количество этажей").default(""),
  onsiteContact: z.string().trim().max(300).default(""),
  accessInstructions: z.string().trim().max(2000).default(""),
  parkingNotes: z.string().trim().max(1000).default(""),
  restrictions: z.string().trim().max(2000).default(""),
  riskLevel: z.coerce.number().int().min(1).max(5).default(3),
  infestationLevel: z.coerce.number().int().min(0).max(5).default(1),
}).refine((value) => value.name.length >= 2 || value.address.length >= 5, "Укажите название или адрес объекта");
const service = z.object({ catalogItemId: z.string().uuid().nullable().optional(), name: z.string().trim().min(2).max(200), quantity: z.string().trim().refine((value) => { try { parseQuantityToMilliunits(value); return true; } catch { return false; } }), unitPrice: optionalMoney, note: z.string().trim().max(1000).default("") });

export const flexibleOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sourceLead: z.object({ id: z.string().uuid(), expectedVersion: z.number().int().positive() }).nullable().default(null),
  client: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("new"), kind: z.enum(["legal_entity", "individual"]), name: z.string().trim().min(2, "Укажите имя или название организации").max(300), taxId: z.string().trim().refine((value) => !value || /^\d{10}(\d{2})?$/.test(value), "ИНН должен содержать 10 или 12 цифр").default(""), email: optionalEmail, primaryPhone: optionalPhone, primaryContactName: z.string().trim().max(200).default(""), primaryContactPosition: z.string().trim().max(120).default("") }),
    z.object({ mode: z.literal("existing"), clientId: z.string().uuid(), existingContactId: z.string().uuid().nullable().default(null) }),
  ]),
  phones: z.array(phone).max(20).default([]),
  contacts: z.array(contact).max(20).default([]),
  objects: z.array(object).max(20).default([]),
  existingObjectIds: z.array(z.string().uuid()).max(20).default([]).refine((ids) => new Set(ids).size === ids.length),
  services: z.array(service).max(100).default([]),
  manualPrice: optionalMoney,
  assignedMasterId: z.string().uuid().nullable().default(null),
  masterPayment: optionalMoney,
  visit: z.object({
    localDate: z.iso.date(),
    localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    arrivalMode: z.enum(["fixed", "window"]),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(),
    notes: z.string().trim().max(4000).default(""),
  }).nullable().default(null),
  notes: z.string().trim().max(4000).default(""),
}).superRefine((value, context) => {
  if (value.visit && !value.existingObjectIds.length && !value.objects.length) context.addIssue({ code: "custom", path: ["visit"], message: "Для выезда выберите объект" });
  if (value.visit?.arrivalMode === "window" && !value.visit.endTime) context.addIssue({ code: "custom", path: ["visit", "endTime"], message: "Укажите конец интервала" });
  if (value.visit?.arrivalMode === "window" && value.visit.localTime === value.visit.endTime) context.addIssue({ code: "custom", path: ["visit", "endTime"], message: "Начало и конец интервала должны различаться" });
  if (value.masterPayment && !value.assignedMasterId) context.addIssue({ code: "custom", path: ["assignedMasterId"], message: "Для выплаты выберите мастера" });
});

export type FlexibleOrderInput = z.infer<typeof flexibleOrderSchema>;
