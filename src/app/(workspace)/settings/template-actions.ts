"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createDocumentTemplate,
  documentTemplateExists,
  DocumentTemplateNotFoundError,
  DocumentTemplateVersionConflictError,
  updateDocumentTemplateStatus,
} from "@/server/document-templates/repository";
import { createDocumentTemplateSchema, updateDocumentTemplateStatusSchema } from "@/server/document-templates/schemas";
import { DocumentFileValidationError, validateDocumentFile } from "@/server/documents/file-validation";
import { createDocumentTemplateStorageKey, removeDocumentFile, writeDocumentFile } from "@/server/documents/storage";

export type DocumentTemplateMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}

function unexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function uploadDocumentTemplateAction(
  _previous: DocumentTemplateMutationState,
  formData: FormData,
): Promise<DocumentTemplateMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает шаблоны.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = createDocumentTemplateSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    title: formData.get("title"),
    description: formData.get("description"),
    kind: "closing_act",
  });
  if (!parsed.success) return { status: "error", message: "Проверьте описание шаблона.", fieldErrors: parsed.error.flatten().fieldErrors };
  const uploadedFile = formData.get("file");
  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) return { status: "error", message: "Выберите PDF или DOCX.", fieldErrors: { file: ["Файл обязателен"] } };

  let storageKey: string | null = null;
  try {
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    const file = validateDocumentFile({ filename: uploadedFile.name, declaredMimeType: uploadedFile.type, buffer });
    if (file.extension !== "pdf" && file.extension !== "docx") {
      return { status: "error", message: "Для шаблона акта разрешены только PDF и DOCX.", fieldErrors: { file: ["Выберите PDF или DOCX"] } };
    }
    const extension: "pdf" | "docx" = file.extension;
    if (await documentTemplateExists(member, parsed.data.idempotencyKey)) return { status: "success", message: "Шаблон уже загружен.", fieldErrors: {} };
    storageKey = createDocumentTemplateStorageKey(member.organizationId, parsed.data.idempotencyKey, extension);
    await writeDocumentFile(storageKey, buffer);
    await createDocumentTemplate(member, { ...parsed.data, ...file, extension, storageKey });
    revalidatePath("/settings");
    revalidatePath("/my-visits");
    return { status: "success", message: "Шаблон акта опубликован.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof DocumentFileValidationError) return { status: "error", message: error.message, fieldErrors: { file: [error.message] } };
    if (errorCode(error) === "EEXIST") {
      if (await documentTemplateExists(member, parsed.data.idempotencyKey)) return { status: "success", message: "Шаблон уже загружен.", fieldErrors: {} };
      return { status: "error", message: "Эта загрузка ещё обрабатывается. Подождите и повторите.", fieldErrors: {} };
    }
    if (storageKey) {
      try { await removeDocumentFile(storageKey); } catch (cleanupError) { unexpected("document_templates.upload.cleanup", member.memberId, cleanupError); }
    }
    unexpected("document_templates.upload", member.memberId, error);
    return { status: "error", message: "Не удалось опубликовать шаблон. Файл не сохранён.", fieldErrors: {} };
  }
}

export async function updateDocumentTemplateStatusAction(
  _previous: DocumentTemplateMutationState,
  formData: FormData,
): Promise<DocumentTemplateMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не изменяет шаблоны.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = updateDocumentTemplateStatusSchema.safeParse({
    templateId: formData.get("templateId"),
    expectedVersion: formData.get("expectedVersion"),
    active: formData.get("active") === "true",
  });
  if (!parsed.success) return { status: "error", message: "Некорректный запрос обновления.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await updateDocumentTemplateStatus(member, parsed.data);
    revalidatePath("/settings");
    revalidatePath("/my-visits");
    return { status: "success", message: parsed.data.active ? "Шаблон опубликован." : "Шаблон снят с публикации.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof DocumentTemplateNotFoundError) return { status: "error", message: "Шаблон больше не существует.", fieldErrors: {} };
    if (error instanceof DocumentTemplateVersionConflictError) return { status: "error", message: "Шаблон уже изменён. Обновите страницу и повторите.", fieldErrors: {} };
    unexpected("document_templates.status_update", member.memberId, error);
    return { status: "error", message: "Не удалось изменить публикацию.", fieldErrors: {} };
  }
}
