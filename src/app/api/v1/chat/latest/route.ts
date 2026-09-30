import { getCurrentSession } from "@/server/auth/session";
import { getChatLatestMessageAt } from "@/server/chat/repository";

export const dynamic = "force-dynamic";

export async function GET() {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "authentication_required" }, { status: 401 });
  const latestAt = await getChatLatestMessageAt(member);
  return Response.json({ latestAt }, { headers: { "Cache-Control": "private, no-store" } });
}
