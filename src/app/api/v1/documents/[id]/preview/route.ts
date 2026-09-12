import mammoth from "mammoth";
import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { readVerifiedDocumentFile } from "@/server/documents/download-response";
import {
  DocumentNotFoundError,
  getDocumentDownload,
} from "@/server/documents/repository";

export const dynamic = "force-dynamic";

const docxMimeType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );
}

function previewDocument(title: string, text: string) {
  const paragraphs = text
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const content = paragraphs.length
    ? paragraphs
        .map(
          (paragraph, index) =>
            `<p${index === 0 ? ' class="lead"' : ""}>${escapeHtml(paragraph)}</p>`,
        )
        .join("")
    : '<p class="empty">В документе нет доступного для просмотра текста.</p>';
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>*{box-sizing:border-box}html{background:#e8e8e5;color:#000;font-family:Georgia,"Times New Roman",serif}body{margin:0;padding:32px 16px}.page{width:min(100%,816px);min-height:1056px;margin:0 auto;background:#fff;padding:76px 82px;box-shadow:0 1px 0 rgba(0,0,0,.08)}h1{margin:0 0 34px;font:700 27px/1.2 Arial,sans-serif;letter-spacing:-.02em}p{margin:0 0 15px;white-space:pre-wrap;font-size:16px;line-height:1.65}.lead{font-size:18px;line-height:1.55}.empty{color:#666}@media(max-width:640px){body{padding:0}.page{min-height:100vh;padding:40px 28px;box-shadow:none}h1{font-size:23px}p{font-size:15px}}</style></head><body><main class="page"><h1>${escapeHtml(title.replace(/\.docx$/i, ""))}</h1>${content}</main></body></html>`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const member = await getCurrentSession();
  if (!member)
    return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id } = await context.params;
    const document = await getDocumentDownload(member, id);
    if (document.mimeType !== docxMimeType)
      return Response.json({ error: "preview_not_supported" }, { status: 415 });
    const file = await readVerifiedDocumentFile(document, "documents.preview");
    const { value } = await mammoth.extractRawText({ buffer: file });
    return new Response(previewDocument(document.filename, value), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'",
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError)
      return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof DocumentNotFoundError)
      return Response.json({ error: "not_found" }, { status: 404 });
    console.error(
      JSON.stringify({
        operation: "documents.preview",
        category: "unexpected",
        memberId: member.memberId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return Response.json({ error: "preview_failed" }, { status: 500 });
  }
}
