import "server-only";
import { createHash } from "node:crypto";
import type { DocumentDownload } from "./types";
import { readDocumentFile } from "./storage";

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
  const file = await readDocumentFile(document.storageKey);
  const actualSha256 = createHash("sha256").update(file).digest("hex");
  if (file.length !== document.sizeBytes || actualSha256 !== document.sha256) {
    console.error(
      JSON.stringify({
        operation,
        category: "integrity_mismatch",
        documentId: document.documentId,
        versionId: document.id,
        expectedSize: document.sizeBytes,
        actualSize: file.length,
      }),
    );
    throw new Error("Document file integrity check failed.");
  }
  return file;
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
