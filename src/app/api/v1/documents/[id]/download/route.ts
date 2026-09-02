import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { createDocumentDownloadResponse } from "@/server/documents/download-response";
import { DocumentNotFoundError, getDocumentDownload } from "@/server/documents/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id } = await context.params;
    const document = await getDocumentDownload(member, id);
    return createDocumentDownloadResponse(document, "documents.download");
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof DocumentNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error(JSON.stringify({ operation: "documents.download", category: "unexpected", memberId: member.memberId, error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: "download_failed" }, { status: 500 });
  }
}
