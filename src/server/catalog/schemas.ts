import { z } from "zod";
import { parseMoneyToMinorUnits } from "@/server/orders/money";

export const catalogItemSchema = z.object({
  id: z.string().uuid().optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
  kind: z.enum(["service", "product"]),
  name: z.string().trim().min(2, "Укажите название").max(200),
  description: z.string().trim().max(2000).optional().transform((value) => value || null),
  sku: z.string().trim().max(80).optional().transform((value) => value || null),
  unit: z.string().trim().min(1, "Укажите единицу измерения").max(40),
  priceMode: z.enum(["fixed", "variable"]),
  defaultPrice: z.string().trim().optional().refine((value) => {
    if (!value) return true;
    try { parseMoneyToMinorUnits(value); return true; } catch { return false; }
  }, "Укажите корректную цену"),
}).superRefine((value, context) => {
  if (value.priceMode === "fixed" && !value.defaultPrice) context.addIssue({ code: "custom", path: ["defaultPrice"], message: "Укажите фиксированную цену" });
  if (Boolean(value.id) !== Boolean(value.expectedVersion)) context.addIssue({ code: "custom", path: ["id"], message: "Обновите страницу и повторите" });
});

export const catalogArchiveSchema = z.object({ id: z.string().uuid(), expectedVersion: z.coerce.number().int().positive(), active: z.boolean() });
export type CatalogItemInput = z.infer<typeof catalogItemSchema>;
