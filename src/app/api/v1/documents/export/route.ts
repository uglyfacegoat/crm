import { AuthorizationError } from "@/server/auth/permissions";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { createDocumentExportArchive, DocumentExportIntegrityError, DocumentExportLimitError, MAX_DOCUMENT_EXPORT_BYTES } from "@/server/documents/export-archive";
import { DocumentNotFoundError, getDocumentBatchExport, recordDocumentBatchExport } from "@/server/documents/repository";
import { documentBatchExportSchema } from "@/server/documents/schemas";
import { readDocumentFile } from "@/server/documents/storage";
import type { DocumentExportFile } from "@/server/documents/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403 });
  if (!request.headers.get("content-type")?.toLocaleLowerCase("en").startsWith("application/json")) {
    return Response.json({ error: { code: "unsupported_media_type", message: "Ожидается JSON." } }, { status: 415 });
  }
  const declaredBodySize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredBodySize) && declaredBodySize > 16 * 1024) {
    return Response.json({ error: { code: "payload_too_large", message: "Слишком большой запрос." } }, { status: 413 });
  }
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401 });

  let payload: unknown;
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > 16 * 1024) {
      return Response.json({ error: { code: "payload_too_large", message: "Слишком большой запрос." } }, { status: 413 });
    }
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: { code: "invalid_json", message: "Некорректный JSON." } }, { status: 400 });
  }
  const parsed = documentBatchExportSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: { code: "validation_error", message: "Выберите от 1 до 30 документов без повторов." } }, { status: 400 });
  }

  try {
    const files = await getDocumentBatchExport(member, parsed.data.documentIds);
    const hydratedFiles: Array<DocumentExportFile & { content: Buffer }> = [];
    let selectedSizeBytes = 0;
    for (const file of files) {
      selectedSizeBytes += file.sizeBytes;
      if (selectedSizeBytes > MAX_DOCUMENT_EXPORT_BYTES) {
        throw new DocumentExportLimitError("Общий размер выбранных документов не должен превышать 50 МБ.");
      }
      hydratedFiles.push({ ...file, content: await readDocumentFile(file.storageKey) });
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
    console.error(JSON.stringify({ operation: "documents.batch_export", category: "unexpected", memberId: member.memberId, error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: { code: "export_failed", message: "Не удалось сформировать архив." } }, { status: 500 });
  }
}
