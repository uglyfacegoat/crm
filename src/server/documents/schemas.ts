import { z } from "zod";
import { documentCategories } from "./types.ts";

const optionalUuid = z.preprocess(
  (value) => (value == null || value === "" ? null : value),
  z.string().uuid().nullable(),
);

export const createDocumentMetadataSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    orderId: z.string().uuid(),
    visitId: optionalUuid,
    contractId: optionalUuid,
    category: z.enum(documentCategories),
    title: z.string().trim().min(2, "Укажите название").max(240),
    description: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? null : value,
      z.string().trim().max(2000).nullable(),
    ),
  })
  .refine((value) => !value.contractId || value.category === "contract", {
    path: ["contractId"],
    message: "К договору можно привязать только файл категории «Договоры».",
  });

export const createDocumentFolderSchema = z.object({
  parentFolderId: optionalUuid,
  name: z.string().trim().min(1, "Укажите название папки").max(120),
});

const uniqueUuidList = z
  .array(z.string().uuid())
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Список содержит повторы.",
  );

export const moveArchiveItemsSchema = z
  .object({
    folderIds: uniqueUuidList,
    documentIds: uniqueUuidList,
    targetFolderId: optionalUuid,
  })
  .refine(
    (value) => value.folderIds.length + value.documentIds.length > 0,
    "Выберите файлы или папки.",
  );

export const favoriteDocumentSchema = z.object({
  documentId: z.string().uuid(),
  favorite: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const createDocumentVersionSchema = z.object({
  idempotencyKey: z.string().uuid(),
  documentId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  changeNote: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(2, "Опишите изменение").max(1000).nullable(),
  ),
});

export const documentBatchExportSchema = z.object({
  documentIds: z
    .array(z.string().uuid())
    .min(1)
    .max(30)
    .refine(
      (documentIds) => new Set(documentIds).size === documentIds.length,
      "Список документов содержит повторы.",
    ),
});

export type CreateDocumentMetadataInput = z.infer<
  typeof createDocumentMetadataSchema
>;
export type CreateDocumentFolderInput = z.infer<
  typeof createDocumentFolderSchema
>;
export type MoveArchiveItemsInput = z.infer<typeof moveArchiveItemsSchema>;
export type CreateDocumentVersionInput = z.infer<
  typeof createDocumentVersionSchema
>;
export type DocumentBatchExportInput = z.infer<
  typeof documentBatchExportSchema
>;
