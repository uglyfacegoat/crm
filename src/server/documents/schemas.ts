import { z } from "zod";
import { documentCategories } from "./types.ts";

const optionalUuid = z.preprocess((value) => value === "" ? null : value, z.string().uuid().nullable());

export const createDocumentMetadataSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderId: z.string().uuid(),
  visitId: optionalUuid,
  category: z.enum(documentCategories),
  title: z.string().trim().min(2, "Укажите название").max(240),
  description: z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().max(2000).nullable()),
});

export const favoriteDocumentSchema = z.object({
  documentId: z.string().uuid(),
  favorite: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const createDocumentVersionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  documentId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  changeNote: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(2, "Опишите изменение").max(1000).nullable(),
  ),
});

export const documentBatchExportSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(30).refine(
    (documentIds) => new Set(documentIds).size === documentIds.length,
    "Список документов содержит повторы.",
  ),
});

export type CreateDocumentMetadataInput = z.infer<typeof createDocumentMetadataSchema>;
export type CreateDocumentVersionInput = z.infer<typeof createDocumentVersionSchema>;
export type DocumentBatchExportInput = z.infer<typeof documentBatchExportSchema>;
