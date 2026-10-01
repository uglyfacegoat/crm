"use server";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { generateOrderDocumentSchema } from "@/server/document-templates/generation-schemas";
import { generateOrderDocument } from "@/server/document-templates/generation";
import { DocumentTemplateGenerationError } from "@/server/document-templates/renderer";
import { DocumentFileValidationError } from "@/server/documents/file-validation";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { documentUploadExists } from "@/server/documents/repository";
import { FileWriteLeaseLostError, FileWritesPausedError } from "../../../server/file-writes/gate.mjs";
import { safeErrorCode } from "@/server/observability/safe-error";

export type GenerateOrderDocumentState = { status: "idle" | "success" | "error"; message: string | null; documentId: string | null; fieldErrors: Record<string, string[]> };
export async function generateOrderDocumentAction(_previous: GenerateOrderDocumentState, formData: FormData): Promise<GenerateOrderDocumentState> {
  const failure = (message: string, fieldErrors: Record<string, string[]> = {}): GenerateOrderDocumentState => ({ status: "error", message, fieldErrors, documentId: null });
  if (getAuthMode() === "preview") return failure("В предпросмотре документы не сохраняются.");
  const member = await requireOfficeSession();
  const parsed = generateOrderDocumentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return failure("Проверьте данные документа.", parsed.error.flatten().fieldErrors);
  let documentId: string | null = null;
  try {
    if (!await documentUploadExists(member, parsed.data.idempotencyKey)) {
      const budget = await consumeRequestLimit(member, "document_upload");
      if (!budget.allowed) return failure(`Повторите генерацию через ${budget.retryAfterSeconds} сек.`);
    }
    const result = await generateOrderDocument(member, parsed.data);
    documentId = result.documentId;
    revalidatePath(`/orders/${parsed.data.orderId}`); revalidatePath("/documents"); revalidatePath("/documents/archive"); revalidatePath("/orders");
    if (parsed.data.visitId) revalidatePath("/my-visits");
    return { status: "success", message: "Документ сформирован и прикреплён к заказу.", documentId, fieldErrors: {} };
  } catch (error) {
    if (documentId) return { status: "success", message: "Документ прикреплён. Обновите страницу, чтобы увидеть его в списке.", documentId, fieldErrors: {} };
    if (error instanceof AuthorizationError) return failure("Недостаточно прав для генерации документов.");
    if (error instanceof DocumentTemplateGenerationError || error instanceof DocumentFileValidationError) return failure(error.message);
    if (error instanceof FileWritesPausedError) return failure("Создание файлов временно остановлено. Повторите позже.");
    if (error instanceof FileWriteLeaseLostError) return failure("Не удалось подтвердить сохранение. Повторите запрос; уже созданный документ не будет продублирован.");
    console.error(JSON.stringify({ operation: "documents.generate", memberId: member.memberId, errorCode: safeErrorCode(error) }));
    return failure("Не удалось подтвердить генерацию. Повторите запрос; уже созданный документ не будет продублирован.");
  }
}
