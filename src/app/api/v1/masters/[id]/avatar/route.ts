import { hasPermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getDatabase } from "@/server/database";
import { getMemberProfileAvatar } from "@/server/members/profile";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!hasPermission(member, "masters.read") && !hasPermission(member, "orders.read")) {
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const { id } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return new Response(null, { status: 404 });
  const [linked] = await getDatabase()`SELECT id FROM organization_members
    WHERE organization_id = ${member.organizationId} AND master_id = ${id} AND active AND deleted_at IS NULL
    ORDER BY created_at LIMIT 1`;
  if (!linked) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const avatar = await getMemberProfileAvatar(member, String(linked.id));
  if (!avatar) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(avatar), { headers: { "Content-Type": "image/webp",
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
