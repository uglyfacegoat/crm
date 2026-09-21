import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/file-limits";
import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { DocumentTemplateNotFoundError, getDocumentTemplateDownload } from "@/server/document-templates/repository";
import { readVerifiedDocumentFile, StoredFileIntegrityError } from "@/server/documents/storage";

export const dynamic = "force-dynamic";

function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id } = await context.params;
    const template = await getDocumentTemplateDownload(member, id);
    const file = await readVerifiedDocumentFile(template.storageKey, template, MAX_DOCUMENT_SIZE_BYTES);
    return new Response(file, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="act-template.${template.filename.split(".").at(-1) ?? "bin"}"; filename*=UTF-8''${encodedFilename(template.filename)}`,
        "Content-Length": String(file.length),
        "Content-Type": template.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof DocumentTemplateNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error(JSON.stringify({ operation: "document_templates.download", category: error instanceof StoredFileIntegrityError ? "integrity_mismatch" : "download_failed", memberId: member.memberId }));
    if (error instanceof StoredFileIntegrityError) return Response.json({ error: "file_integrity_error" }, { status: 500 });
    return Response.json({ error: "download_failed" }, { status: 500 });
  }
}
