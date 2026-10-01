import { z } from "zod";
const area = z.string().trim().regex(/^(?:\d{1,7}(?:[.,]\d{1,3})?)?$/, "Укажите площадь числом").default("");
export const generateOrderDocumentSchema = z.object({
  idempotencyKey: z.string().uuid(), orderId: z.string().uuid(), expectedOrderVersion: z.coerce.number().int().positive(),
  templateId: z.string().uuid(), expectedTemplateVersion: z.coerce.number().int().positive(),
  visitId: z.union([z.literal(""), z.string().uuid(), z.null()]).transform(value => value || null).default(null),
  documentDate: z.iso.date("Укажите дату документа"), executorName: z.string().trim().max(200).default(""),
  services: z.string().trim().max(1800).default(""), preparations: z.string().trim().max(1500).default(""),
  recommendations: z.string().trim().max(1500).default(""),
  areaDeratization: area, areaDisinsection: area, areaDisinfection: area,
});
export type GenerateOrderDocumentInput = z.infer<typeof generateOrderDocumentSchema>;
