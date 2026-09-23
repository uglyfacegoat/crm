import { safeErrorCode } from "@/server/observability/safe-error";
import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { rejectLimitedFileRead } from "@/server/request-limits/file-read";
import { createDocumentDownloadResponse } from "@/server/documents/download-response";
import { DocumentNotFoundError, getDocumentVersionDownload } from "@/server/documents/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; versionId: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id, versionId } = await context.params;
    const document = await getDocumentVersionDownload(member, id, versionId);
    const limited = await rejectLimitedFileRead(member, "document_download");
    if (limited) return limited;
    return createDocumentDownloadResponse(document, "documents.version_download");
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof DocumentNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error(JSON.stringify({ operation: "documents.version_download", category: "unexpected", memberId: member.memberId, errorCode: safeErrorCode(error) }));
    return Response.json({ error: "download_failed" }, { status: 500 });
  }
}
