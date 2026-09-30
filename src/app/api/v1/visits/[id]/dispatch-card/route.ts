import { safeErrorCode } from "@/server/observability/safe-error";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, hasPermission } from "@/server/auth/permissions";
import { getCurrentSession } from "@/server/auth/session";
import { getPreviewVisitDispatchCard } from "@/server/visits/preview-dispatch-card";
import { getVisitDispatchCard, VisitNotFoundError } from "@/server/visits/repository";
import { visitIdSchema } from "@/server/visits/schemas";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const member = await getCurrentSession();
    if (!member) return Response.json({ error: { code: "unauthenticated", message: "Требуется вход." } }, { status: 401 });
    const { id } = await params;
    if (getAuthMode() === "preview") {
      const card = getPreviewVisitDispatchCard(id, hasPermission(member, "finance.read"));
      if (!card) return Response.json({ error: { code: "not_found", message: "Выезд не найден." } }, { status: 404 });
      return Response.json({ data: card }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const parsedId = visitIdSchema.safeParse(id);
    if (!parsedId.success) return Response.json({ error: { code: "validation_error", message: "Некорректный идентификатор выезда." } }, { status: 400 });
    const card = await getVisitDispatchCard(member, parsedId.data);
    return Response.json({ data: card }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: { code: "forbidden", message: "Недостаточно прав для просмотра карточки выезда." } }, { status: 403 });
    if (error instanceof VisitNotFoundError) return Response.json({ error: { code: "not_found", message: "Выезд не найден." } }, { status: 404 });
    console.error(JSON.stringify({ operation: "visits.dispatch_card.read", category: "unexpected", errorCode: safeErrorCode(error) }));
    return Response.json({ error: { code: "service_unavailable", message: "Не удалось загрузить карточку выезда." } }, { status: 503 });
  }
}
