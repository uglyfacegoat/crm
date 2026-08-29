import { z } from "zod";
import { documentCategories } from "./types";

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

export type CreateDocumentMetadataInput = z.infer<typeof createDocumentMetadataSchema>;
