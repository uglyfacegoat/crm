import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import { isSameOriginRequest } from "@/server/auth/request";
import { getCurrentSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import { createTask, TaskAssigneeNotFoundError, TaskOrderNotFoundError } from "@/server/tasks/repository";
import { createTaskSchema } from "@/server/tasks/schemas";

const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Недопустимый источник запроса." }, { status: 403, headers });
  const member = await getCurrentSession();
  if (!member) return Response.json({ error: "Сессия закончилась. Войдите в CRM снова." }, { status: 401, headers });
  if (getAuthMode() === "preview") return Response.json({ error: "Предпросмотр не записывает задачи." }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "Неверный формат данных." }, { status: 415, headers });
  try {
    requirePermission(member, "tasks.write");
    const raw = await request.text();
    if (raw.length > 16_000) return Response.json({ error: "Слишком большой запрос." }, { status: 413, headers });
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: "Некорректные данные задачи." }, { status: 400, headers }); }
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Проверьте поля задачи.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422, headers });
    }
    const taskId = await createTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return Response.json({ taskId }, { status: 201, headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return Response.json({ error: "Недостаточно прав для создания задачи." }, { status: 403, headers });
    if (error instanceof TaskAssigneeNotFoundError) return Response.json({ error: "Выбранный сотрудник отключён или больше не существует.", fieldErrors: { assignedMemberId: ["Выберите активного сотрудника"] } }, { status: 422, headers });
    if (error instanceof TaskOrderNotFoundError) return Response.json({ error: "Выбранный заказ закрыт или больше не существует.", fieldErrors: { relatedOrderId: ["Выберите доступный заказ"] } }, { status: 422, headers });
    console.error(JSON.stringify({ operation: "task.create", category: "unexpected", memberId: member.memberId, errorCode: safeErrorCode(error) }));
    return Response.json({ error: "Не удалось создать задачу. Данные не сохранены." }, { status: 503, headers });
  }
}
