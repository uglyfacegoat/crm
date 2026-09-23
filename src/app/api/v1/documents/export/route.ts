import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/file-limits";
import { AuthorizationError } from "@/server/auth/permissions";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { consumeRequestLimit } from "@/server/request-limits/repository";
import { createDocumentExportArchive, DocumentExportIntegrityError, DocumentExportLimitError, MAX_DOCUMENT_EXPORT_BYTES } from "@/server/documents/export-archive";
import { DocumentNotFoundError, getDocumentBatchExport, recordDocumentBatchExport } from "@/server/documents/repository";
import { documentBatchExportSchema } from "@/server/documents/schemas";
import { readVerifiedDocumentFile, StoredFileIntegrityError } from "@/server/documents/storage";
import type { DocumentExportFile } from "@/server/documents/types";
import { InvalidJsonBodyError, readJsonBody, RequestBodyTooLargeError } from "@/server/http/json-body";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403 });
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en").startsWith("application/json")) {
    return Response.json({ error: { code: "unsupported_media_type", message: "Ожидается JSON." } }, { status: 415 });
  }
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401 });

  let payload: unknown;
  try {
    payload = await readJsonBody(request, 16 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: { code: "payload_too_large", message: "Слишком большой запрос." } }, { status: 413 });
    if (error instanceof InvalidJsonBodyError) return Response.json({ error: { code: "invalid_json", message: "Некорректный JSON." } }, { status: 400 });
    throw error;
  }
  const parsed = documentBatchExportSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: { code: "validation_error", message: "Выберите от 1 до 30 документов без повторов." } }, { status: 400 });
  }

  try {
    const files = await getDocumentBatchExport(member, parsed.data.documentIds);
    const budget = await consumeRequestLimit(member, "document_export");
    if (!budget.allowed) return Response.json({ error: { code: "rate_limited", message: "Слишком много выгрузок. Повторите позже." } }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(budget.retryAfterSeconds) } });
    const hydratedFiles: Array<DocumentExportFile & { content: Buffer }> = [];
    let selectedSizeBytes = 0;
    for (const file of files) {
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
        throw new DocumentExportIntegrityError(file.documentId);
      }
      selectedSizeBytes += file.sizeBytes;
      if (selectedSizeBytes > MAX_DOCUMENT_EXPORT_BYTES) {
        throw new DocumentExportLimitError("Общий размер выбранных документов не должен превышать 50 МБ.");
      }
    }
    for (const file of files) {
      try {
        hydratedFiles.push({ ...file, content: await readVerifiedDocumentFile(file.storageKey, file, MAX_DOCUMENT_SIZE_BYTES) });
      } catch (error) {
        if (error instanceof StoredFileIntegrityError) throw new DocumentExportIntegrityError(file.documentId);
        throw error;
      }
    }
    const { archive, totalSizeBytes } = createDocumentExportArchive(hydratedFiles);
    await recordDocumentBatchExport(member, files, totalSizeBytes);
    const dateParts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow" })
      .formatToParts(new Date()).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
    if (!dateParts.year || !dateParts.month || !dateParts.day) throw new Error("Unable to format the export date.");
    const date = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
    return new Response(archive, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="crm-documents-${date}.zip"`,
        "Content-Length": String(archive.length),
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для экспорта документов." } }, { status: 403 });
    if (error instanceof DocumentNotFoundError) return Response.json({ error: { code: "not_found", message: "Один или несколько документов недоступны." } }, { status: 404 });
    if (error instanceof DocumentExportLimitError) return Response.json({ error: { code: "export_too_large", message: error.message } }, { status: 413 });
    if (error instanceof DocumentExportIntegrityError) {
      console.error(JSON.stringify({ operation: "documents.batch_export", category: "integrity_mismatch", memberId: member.memberId, documentId: error.documentId }));
      return Response.json({ error: { code: "file_integrity_error", message: "Целостность одного из файлов нарушена. Архив не создан." } }, { status: 500 });
    }
    console.error(JSON.stringify({ operation: "documents.batch_export", category: "export_failed", memberId: member.memberId }));
    return Response.json({ error: { code: "export_failed", message: "Не удалось сформировать архив." } }, { status: 500 });
  }
}
