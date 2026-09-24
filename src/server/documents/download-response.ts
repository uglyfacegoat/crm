import "server-only";
import { MAX_DOCUMENT_SIZE_BYTES } from "@/lib/file-limits";
import type { DocumentDownload } from "./types";
import { readVerifiedDocumentFile as readStoredFile, StoredFileIntegrityError } from "./storage";

function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export async function readVerifiedDocumentFile(
  document: DocumentDownload,
  operation: string,
) {
  try {
    return await readStoredFile(document.storageKey, document, MAX_DOCUMENT_SIZE_BYTES);
  } catch (error) {
    console.error(
      JSON.stringify({
        operation,
        category: error instanceof StoredFileIntegrityError ? "integrity_mismatch" : "storage_read_failed",
        documentId: document.documentId,
        versionId: document.id,
        expectedSize: document.sizeBytes,
      }),
    );
    throw error;
  }
}

export async function createDocumentDownloadResponse(
  document: DocumentDownload,
  operation: string,
  disposition: "attachment" | "inline" = "attachment",
) {
  let file: Buffer;
  try {
    file = await readVerifiedDocumentFile(document, operation);
  } catch {
    return Response.json({ error: "file_integrity_error" }, { status: 500 });
  }
  return new Response(Uint8Array.from(file), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `${disposition}; filename="document.${document.filename.split(".").at(-1) ?? "bin"}"; filename*=UTF-8''${encodedFilename(document.filename)}`,
      "Content-Length": String(file.length),
      "Content-Type": document.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
