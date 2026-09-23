import { AuthorizationError } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { rejectLimitedFileRead } from "@/server/request-limits/file-read";
import { ChatChannelNotFoundError, getChatChannelAvatarDownload } from "@/server/chat/repository";
import { MAX_CHAT_AVATAR_BYTES } from "@/server/chat/file-validation";
import { readVerifiedDocumentFile, StoredFileIntegrityError } from "@/server/documents/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  try {
    const { id } = await context.params;
    const avatar = await getChatChannelAvatarDownload(member, id);
    const limited = await rejectLimitedFileRead(member, "chat_download");
    if (limited) return limited;
    const file = await readVerifiedDocumentFile(avatar.storageKey, avatar, MAX_CHAT_AVATAR_BYTES);
    return new Response(Uint8Array.from(file), { headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(file.length),
      "Content-Type": avatar.mimeType,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof ChatChannelNotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    console.error(JSON.stringify({ operation: "chat.avatar.read", category: error instanceof StoredFileIntegrityError ? "integrity_mismatch" : "avatar_failed", memberId: member.memberId }));
    if (error instanceof StoredFileIntegrityError) return Response.json({ error: "file_integrity_error" }, { status: 500 });
    return Response.json({ error: "avatar_failed" }, { status: 500 });
  }
}
