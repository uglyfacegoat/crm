import { getCurrentSession } from "@/server/auth/session";
import { getOwnProfileAvatar } from "@/server/members/profile";

export async function GET() {
  const member = await getCurrentSession();
  if (!member) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  const avatar = await getOwnProfileAvatar(member);
  if (!avatar) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(avatar), { headers: { "Content-Type": "image/webp", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
