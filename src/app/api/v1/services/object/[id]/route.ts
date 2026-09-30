import { z } from "zod";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getObjectServiceProfile } from "@/server/catalog/object-service-profiles";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "Требуется вход." }, { status: 401 });
  if (!hasPermission(member, "orders.read")) return Response.json({ error: "Нет доступа." }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Некорректный объект." }, { status: 400 });
  if (getAuthMode() === "preview") return Response.json({ data: null }, { headers: { "Cache-Control": "private, no-store" } });
  const profile = await getObjectServiceProfile(member, id);
  if (!profile) return Response.json({ error: "Объект не найден." }, { status: 404 });
  return Response.json({ data: profile }, { headers: { "Cache-Control": "private, no-store" } });
}
