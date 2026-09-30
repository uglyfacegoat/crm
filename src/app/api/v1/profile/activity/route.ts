import { getAuthMode } from "@/server/auth/config";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { isScreenKey } from "@/lib/member-activity";
import { recordMemberScreenActivity } from "@/server/members/activity";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isSameOriginRequest(request)) return new Response(null, { status: 403, headers });
  const member = await getCurrentSession();
  if (!member) return new Response(null, { status: 401, headers });
  if (getAuthMode() === "preview") return new Response(null, { status: 204, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return new Response(null, { status: 415, headers });
  const body = await request.text();
  if (body.length > 128) return new Response(null, { status: 413, headers });
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return new Response(null, { status: 400, headers }); }
  const screen = typeof parsed === "object" && parsed !== null && "screen" in parsed ? parsed.screen : null;
  if (!isScreenKey(screen)) return new Response(null, { status: 422, headers });
  await recordMemberScreenActivity(member, screen);
  return new Response(null, { status: 204, headers });
}
