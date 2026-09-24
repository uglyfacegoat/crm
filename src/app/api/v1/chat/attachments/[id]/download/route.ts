import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { MAX_CHAT_ATTACHMENT_BYTES } from "@/server/chat/file-validation";
import { ChatChannelNotFoundError, getChatAttachmentDownload, recordChatAttachmentDownload } from "@/server/chat/repository";
import { readVerifiedDocumentFile, StoredFileIntegrityError } from "@/server/documents/storage";
import { selectByteRange } from "@/server/http/byte-range";
import { consumeRequestLimit } from "@/server/request-limits/repository";

export const dynamic = "force-dynamic";

function encodedFilename(filename: string) {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401, headers: privateHeaders });
  let stage = "authorize";
  try {
    const { id } = await context.params;
    const attachment = await getChatAttachmentDownload(member, id);
    stage = "budget";
    const budget = await consumeRequestLimit(member, "chat_download");
    if (!budget.allowed) {
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...privateHeaders, "Retry-After": String(budget.retryAfterSeconds) } });
    }
    stage = "read";
    const file = await readVerifiedDocumentFile(attachment.storageKey, attachment, MAX_CHAT_ATTACHMENT_BYTES);
    const etag = `"${attachment.sha256}"`;
    const headers = new Headers({
        ...privateHeaders,
        "Accept-Ranges": "bytes",
        ETag: etag,
        "Content-Disposition": `${attachment.mimeType.startsWith("audio/") ? "inline" : "attachment"}; filename="chat-file.${attachment.filename.split(".").at(-1) ?? "bin"}"; filename*=UTF-8''${encodedFilename(attachment.filename)}`,
        "Content-Type": attachment.mimeType,
    });
    const ifMatch = request.headers.get("if-match");
    if (ifMatch && ifMatch !== "*" && !ifMatch.split(",").some((tag) => tag.trim() === etag)) {
      return new Response(null, { status: 412, headers });
    }
    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag))) {
      return new Response(null, { status: 304, headers });
    }
    const ifRange = request.headers.get("if-range");
    const range = selectByteRange(request.method === "GET" && (!ifRange || ifRange === etag) ? request.headers.get("range") : null, file.length);
    if (range.kind === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${file.length}`);
      return new Response(null, { status: 416, headers });
    }
    const body = range.kind === "partial" ? file.subarray(range.start, range.end + 1) : file;
    headers.set("Content-Length", String(body.length));
    if (range.kind === "partial") headers.set("Content-Range", `bytes ${range.start}-${range.end}/${file.length}`);
    if (request.method === "HEAD") return new Response(null, { headers });
    stage = "audit";
    await recordChatAttachmentDownload(member, attachment.id);
    return new Response(body, { status: range.kind === "partial" ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403, headers: privateHeaders });
    if (error instanceof ChatChannelNotFoundError) return Response.json({ error: "not_found" }, { status: 404, headers: privateHeaders });
    const integrityFailure = error instanceof StoredFileIntegrityError;
    console.error(JSON.stringify({ operation: "chat.attachment.download", category: integrityFailure ? "integrity_mismatch" : "unexpected", stage, memberId: member.memberId }));
    return Response.json({ error: integrityFailure ? "file_integrity_error" : "download_failed" }, { status: stage === "budget" ? 503 : 500, headers: privateHeaders });
  }
}

export const HEAD = GET;
