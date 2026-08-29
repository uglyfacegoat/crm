import { createHash } from "node:crypto";
import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { DocumentNotFoundError, getDocumentDownload } from "@/server/documents/repository";
import { readDocumentFile } from "@/server/documents/storage";

export const dynamic = "force-dynamic";

function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id } = await context.params;
    const document = await getDocumentDownload(member, id);
    const file = await readDocumentFile(document.storageKey);
    const actualSha256 = createHash("sha256").update(file).digest("hex");
    if (file.length !== document.sizeBytes || actualSha256 !== document.sha256) {
      console.error(JSON.stringify({ operation: "documents.download", category: "integrity_mismatch", documentId: document.id, expectedSize: document.sizeBytes, actualSize: file.length }));
      return Response.json({ error: "file_integrity_error" }, { status: 500 });
    }
    return new Response(file, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="document.${document.filename.split(".").at(-1) ?? "bin"}"; filename*=UTF-8''${encodedFilename(document.filename)}`,
        "Content-Length": String(file.length),
        "Content-Type": document.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof DocumentNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error(JSON.stringify({ operation: "documents.download", category: "unexpected", memberId: member.memberId, error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ error: "download_failed" }, { status: 500 });
  }
}
