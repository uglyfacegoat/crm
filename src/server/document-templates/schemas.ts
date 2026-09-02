import { z } from "zod";

export const createDocumentTemplateSchema = z.object({
  idempotencyKey: z.string().uuid(),
  title: z.string().trim().min(2, "Укажите название шаблона").max(240),
  description: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(2000).nullable()),
  kind: z.literal("closing_act"),
});

export const updateDocumentTemplateStatusSchema = z.object({
  templateId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  active: z.boolean(),
});

export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;
export type UpdateDocumentTemplateStatusInput = z.infer<typeof updateDocumentTemplateStatusSchema>;
