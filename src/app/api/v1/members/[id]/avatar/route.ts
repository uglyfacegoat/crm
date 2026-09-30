import { getCurrentSession } from "@/server/auth/session";
import { getMemberProfileAvatar } from "@/server/members/profile";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 404 });
  const avatar = await getMemberProfileAvatar(member, id);
  if (!avatar) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(avatar), { headers: { "Content-Type": "image/webp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
