import { z } from "zod";
import { isValidContactPhone } from "../clients/phone.ts";
import { parseMoneyToMinorUnits } from "../orders/money.ts";
import { masterOperationalStatuses } from "./types.ts";

export const masterIdSchema = z.string().uuid();

const contactPhone = z
  .string()
  .trim()
  .min(7, "Введите телефон")
  .max(40)
  .refine(isValidContactPhone, "Телефон должен содержать от 10 до 15 цифр");
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null);
const payment = z
  .string()
  .trim()
  .refine((value) => {
    try {
      return parseMoneyToMinorUnits(value) <= 100_000_000_00n;
    } catch {
      return false;
    }
  }, "Укажите сумму до 100 млн ₽, не более двух знаков после запятой")
  .transform((value) => Number(parseMoneyToMinorUnits(value)));
const skills = z
  .string()
  .trim()
  .max(1_500)
  .transform((value) =>
    Array.from(
      new Set(
        value
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
      ),
    ),
  )
  .refine(
    (value) => value.length <= 30 && value.every((skill) => skill.length <= 80),
    "Укажите не более 30 специализаций",
  );
const workingDays = z
  .array(z.coerce.number().int().min(1).max(7))
  .min(1, "Выберите хотя бы один рабочий день")
  .transform((value) => [...new Set(value)].sort());
const statusUntil = z
  .union([z.literal(""), z.iso.date()])
  .transform((value) => value || null);

const masterFields = {
  fullName: z.string().trim().min(2, "Введите ФИО").max(200),
  phone: contactPhone,
  messenger: optionalText(120),
  serviceRegion: z.string().trim().min(2, "Укажите регион").max(160),
  serviceZone: z.string().trim().min(1, "Укажите зону").max(160),
  basePaymentMinor: payment,
  dailyCapacity: z.coerce
    .number()
    .int()
    .min(1, "Минимум один выезд")
    .max(20, "Максимум 20 выездов"),
  skills,
  notes: optionalText(4_000),
  operationalStatus: z.enum(masterOperationalStatuses),
  workingDays,
  statusUntil,
  statusNote: optionalText(1_000),
};

function validateAvailability(
  value: {
    operationalStatus: (typeof masterOperationalStatuses)[number];
    statusNote: string | null;
  },
  context: z.RefinementCtx,
) {
  if (value.operationalStatus !== "working" && !value.statusNote) {
    context.addIssue({
      code: "custom",
      path: ["statusNote"],
      message: "Укажите причину статуса",
    });
  }
}

export const createMasterSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    ...masterFields,
    operationalStatus: z.literal("working"),
  })
  .superRefine(validateAvailability);

export const updateMasterSchema = z
  .object({
    masterId: masterIdSchema,
    expectedVersion: z.coerce.number().int().positive(),
    ...masterFields,
    active: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.operationalStatus === "terminated" && value.active)
      context.addIssue({
        code: "custom",
        path: ["active"],
        message: "Уволенный мастер не может быть активным",
      });
    validateAvailability(value, context);
  });

export type CreateMasterInput = z.infer<typeof createMasterSchema>;
export type UpdateMasterInput = z.infer<typeof updateMasterSchema>;
