import { z } from "zod";
import { parseMoneyToMinorUnits } from "@/server/orders/money";

const optionalMoney = z.string().trim().refine((value) => {
  if (!value) return true;
  try { parseMoneyToMinorUnits(value); return true; } catch { return false; }
}, "Укажите сумму в рублях с точностью до копеек");
const optionalDecimal = z.string().trim().refine((value) => !value || (
  /^\d{1,10}(?:[.,]\d{1,2})?$/.test(value.replaceAll(" ", ""))
  && Number(value.replaceAll(" ", "").replace(",", ".")) > 0
), "Укажите положительное число с точностью до сотых");

export const objectServiceProfileSchema = z.object({
  organizationId: z.string().uuid(),
  objectId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  areaSquareMeters: optionalDecimal,
  visitsPerMonth: z.number().int().min(1).max(31).nullable(),
  serviceSchedule: z.string().trim().max(500),
  contractTotal: optionalMoney,
  notes: z.string().trim().max(2000),
  rates: z.array(z.object({
    catalogItemId: z.string().uuid().nullable(),
    name: z.string().trim().min(2).max(200),
    lineKind: z.enum(["contract", "request"]),
    billingBasis: z.enum(["area", "quantity", "fixed"]),
    quantity: optionalDecimal,
    unitPrice: optionalMoney,
  }).superRefine((rate, context) => {
    if (rate.billingBasis === "quantity" && (!rate.quantity || Number(rate.quantity.replace(",", ".")) <= 0))
      context.addIssue({ code: "custom", path: ["quantity"], message: "Укажите количество" });
  })).max(100),
});
export type ObjectServiceProfileInput = z.infer<typeof objectServiceProfileSchema>;
