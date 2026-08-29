"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { DocumentFileValidationError, validateDocumentFile } from "@/server/documents/file-validation";
import {
  createDocument,
  DocumentNotFoundError,
  DocumentReferenceError,
  documentUploadExists,
  setDocumentFavorite,
} from "@/server/documents/repository";
import { createDocumentMetadataSchema, favoriteDocumentSchema } from "@/server/documents/schemas";
import { createDocumentStorageKey, removeDocumentFile, writeDocumentFile } from "@/server/documents/storage";

export type DocumentUploadState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function uploadDocumentAction(_previous: DocumentUploadState, formData: FormData): Promise<DocumentUploadState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает файлы. Включите рабочий режим.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = createDocumentMetadataSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    orderId: formData.get("orderId"),
    visitId: formData.get("visitId"),
    category: formData.get("category"),
    title: formData.get("title"),
    description: formData.get("description"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте связи и описание документа.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
  const uploadedFile = formData.get("file");
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) return { status: "error", message: "Выберите файл.", fieldErrors: { file: ["Файл обязателен"] } };

  let storageKey: string | null = null;
  try {
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const file = validateDocumentFile({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
    if (await documentUploadExists(member, parsed.data.idempotencyKey)) return { status: "success", message: "Документ уже загружен.", fieldErrors: {} };
    storageKey = createDocumentStorageKey(member.organizationId, parsed.data.idempotencyKey, file.extension);
    await writeDocumentFile(storageKey, buffer);
    await createDocument(member, { ...parsed.data, ...file, storageKey });
    revalidatePath("/documents");
    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { status: "success", message: "Документ сохранён в архиве.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { file: [error.message] } };
    if (error instanceof DocumentReferenceError) {
      if (storageKey) await removeDocumentFile(storageKey);
      const message = error.field === "order" ? "Заказ больше не существует или недоступен." : "Выезд не относится к выбранному заказу.";
      return { status: "error", message, fieldErrors: { [`${error.field}Id`]: [message] } };
    }
    if (errorCode(error) === "EEXIST") {
      if (await documentUploadExists(member, parsed.data.idempotencyKey)) return { status: "success", message: "Документ уже загружен.", fieldErrors: {} };
      return { status: "error", message: "Эта загрузка ещё обрабатывается. Подождите и повторите.", fieldErrors: {} };
    }
    if (storageKey) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { logUnexpected("documents.upload.cleanup", member.memberId, cleanupError); }
    }
    logUnexpected("documents.upload", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить документ. Файл не добавлен.", fieldErrors: {} };
  }
}

export async function favoriteDocumentAction(formData: FormData) {
  const member = await requireSession();
  const parsed = favoriteDocumentSchema.safeParse({ documentId: formData.get("documentId"), favorite: formData.get("favorite") });
  if (!parsed.success) throw new Error("Invalid favorite request.");
  try {
    await setDocumentFavorite(member, parsed.data.documentId, parsed.data.favorite);
    revalidatePath("/documents");
  } catch (error) {
    if (error instanceof DocumentNotFoundError) throw new Error("Документ больше не существует.");
    if (error instanceof AuthorizationError) throw error;
    logUnexpected("documents.favorite", member.memberId, error);
    throw new Error("Не удалось изменить избранное.");
  }
}
