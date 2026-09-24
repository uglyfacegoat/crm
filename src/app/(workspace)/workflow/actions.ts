"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import { addWorkflowComment, findWorkflowResources, listWorkflowComments, type WorkflowCommentPage, type WorkflowResourceOption } from "@/server/workflow/context-repository";
import { WorkflowContextTargetError } from "@/server/workflow/context-access";
import { previewOrderCreatedAutomation, WorkflowAutomationTargetError, type WorkflowAutomationPreview } from "@/server/workflow/automation-repository";
import { WorkflowAutomationPlanError } from "@/server/workflow/automation-plan";
import { watchWorkflowMap, WorkflowCollaborationMapNotFoundError } from "@/server/workflow/collaboration-repository";
import {
  archiveWorkflowMap, createWorkflowMap, saveWorkflowMap,
  WorkflowMapConflictError, WorkflowMapNotFoundError,
} from "@/server/workflow/repository";
import {
  approveWorkflowReview, getWorkflowRevision, publishWorkflowRevision,
  rejectWorkflowReview, requestWorkflowReview, restoreWorkflowRevision,
  WorkflowReviewStateError, type WorkflowRevision,
} from "@/server/workflow/versions-repository";
import {
  archiveWorkflowMapSchema, createWorkflowMapSchema, saveWorkflowMapSchema,
  rejectWorkflowReviewSchema, restoreWorkflowRevisionSchema,
  workflowRevisionLookupSchema, workflowVersionCommandSchema,
  addWorkflowCommentSchema, workflowCommentPageSchema, workflowResourceSearchSchema, watchWorkflowMapSchema,
  previewWorkflowAutomationSchema,
  type ArchiveWorkflowMapInput, type CreateWorkflowMapInput, type SaveWorkflowMapInput,
  type RejectWorkflowReviewInput, type RestoreWorkflowRevisionInput,
  type WorkflowRevisionLookupInput, type WorkflowVersionCommandInput,
  type AddWorkflowCommentInput, type WorkflowCommentPageInput, type WorkflowResourceSearchInput, type WatchWorkflowMapInput,
  type PreviewWorkflowAutomationInput,
} from "@/server/workflow/schemas";

type WorkflowActionResult = {
  status: "success" | "error";
  message: string;
  id: string | null;
  version: number | null;
};

function failure(error: unknown, operation: string, memberId: string): WorkflowActionResult {
  if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для изменения карты.", id: null, version: null };
  if (error instanceof WorkflowMapNotFoundError) return { status: "error", message: "Карта недоступна или уже архивирована.", id: null, version: null };
  if (error instanceof WorkflowCollaborationMapNotFoundError) return { status: "error", message: "Карта недоступна или уже архивирована.", id: null, version: null };
  if (error instanceof WorkflowMapConflictError) return { status: "error", message: "Карту изменили в другой вкладке. Обновите страницу, чтобы увидеть актуальную версию.", id: null, version: null };
  if (error instanceof WorkflowContextTargetError) return { status: "error", message: error.kind === "owner" ? "Ответственный сотрудник больше недоступен." : "Связанная запись CRM больше недоступна.", id: null, version: null };
  if (error instanceof WorkflowReviewStateError) {
    const messages = {
      empty: "Добавьте хотя бы один блок перед согласованием.",
      not_requested: "Эта версия не ожидает согласования.",
      self_review: "Согласовать карту должен другой сотрудник с соответствующим правом.",
      not_approved: "Эта версия ещё не согласована.",
      already_approved: "Эта версия уже согласована и готова к публикации.",
      already_published: "Эта версия уже опубликована. Измените черновик для новой публикации.",
    };
    return { status: "error", message: messages[error.reason], id: null, version: null };
  }
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, errorCode: safeErrorCode(error) }));
  return { status: "error", message: "Не удалось сохранить карту. Попробуйте ещё раз.", id: null, version: null };
}

export async function createWorkflowMapAction(input: CreateWorkflowMapInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет карты.", id: null, version: null };
  const member = await requireSession();
  const parsed = createWorkflowMapSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Название карты должно содержать от 2 до 120 символов.", id: null, version: null };
  try {
    const id = await createWorkflowMap(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Карта создана.", id, version: 1 };
  } catch (error) { return failure(error, "workflow.map.create", member.memberId); }
}

export async function saveWorkflowMapAction(input: SaveWorkflowMapInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет карты.", id: null, version: null };
  const member = await requireSession();
  const parsed = saveWorkflowMapSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Проверьте поля, узлы и связи карты.", id: null, version: null };
  try {
    const version = await saveWorkflowMap(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Карта сохранена.", id: parsed.data.id, version };
  } catch (error) { return failure(error, "workflow.map.save", member.memberId); }
}

export async function archiveWorkflowMapAction(input: ArchiveWorkflowMapInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не архивирует карты.", id: null, version: null };
  const member = await requireSession();
  const parsed = archiveWorkflowMapSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректные данные карты.", id: null, version: null };
  try {
    await archiveWorkflowMap(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Карта перенесена в архив.", id: parsed.data.id, version: parsed.data.expectedVersion + 1 };
  } catch (error) { return failure(error, "workflow.map.archive", member.memberId); }
}

export async function getWorkflowRevisionAction(input: WorkflowRevisionLookupInput): Promise<{ status: "success"; revision: WorkflowRevision } | { status: "error"; message: string }> {
  if (getAuthMode() === "preview") return { status: "error", message: "История недоступна в предпросмотре." };
  const member = await requireSession();
  const parsed = workflowRevisionLookupSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная версия карты." };
  try { return { status: "success", revision: await getWorkflowRevision(member, parsed.data) }; }
  catch (error) { return { status: "error", message: failure(error, "workflow.revision.read", member.memberId).message }; }
}

export async function requestWorkflowReviewAction(input: WorkflowVersionCommandInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = workflowVersionCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная версия карты.", id: null, version: null };
  try {
    await requestWorkflowReview(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Версия отправлена на согласование.", id: input.id, version: input.expectedVersion };
  } catch (error) { return failure(error, "workflow.review.request", member.memberId); }
}

export async function approveWorkflowReviewAction(input: WorkflowVersionCommandInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = workflowVersionCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная версия карты.", id: null, version: null };
  try {
    await approveWorkflowReview(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Версия согласована.", id: input.id, version: input.expectedVersion };
  } catch (error) { return failure(error, "workflow.review.approve", member.memberId); }
}

export async function rejectWorkflowReviewAction(input: RejectWorkflowReviewInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = rejectWorkflowReviewSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Укажите причину отказа от 2 до 500 символов.", id: null, version: null };
  try {
    await rejectWorkflowReview(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Версия возвращена на доработку.", id: input.id, version: input.expectedVersion };
  } catch (error) { return failure(error, "workflow.review.reject", member.memberId); }
}

export async function publishWorkflowRevisionAction(input: WorkflowVersionCommandInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = workflowVersionCommandSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная версия карты.", id: null, version: null };
  try {
    await publishWorkflowRevision(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Согласованная версия опубликована.", id: input.id, version: input.expectedVersion };
  } catch (error) { return failure(error, "workflow.revision.publish", member.memberId); }
}

export async function restoreWorkflowRevisionAction(input: RestoreWorkflowRevisionInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = restoreWorkflowRevisionSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная версия карты.", id: null, version: null };
  try {
    const version = await restoreWorkflowRevision(member, parsed.data);
    // The editor reloads after restore so its local draft is replaced with the new version.
    return { status: "success", message: `Версия ${input.sourceVersion} восстановлена в новый черновик.`, id: input.id, version };
  } catch (error) { return failure(error, "workflow.revision.restore", member.memberId); }
}

export async function addWorkflowCommentAction(input: AddWorkflowCommentInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = addWorkflowCommentSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Комментарий должен содержать от 2 до 2000 символов.", id: null, version: null };
  try {
    const id = await addWorkflowComment(member, parsed.data);
    revalidatePath("/workflow");
    return { status: "success", message: "Комментарий добавлен.", id, version: null };
  } catch (error) { return failure(error, "workflow.comment.add", member.memberId); }
}

export async function findWorkflowResourcesAction(input: WorkflowResourceSearchInput): Promise<{ status: "success"; options: WorkflowResourceOption[] } | { status: "error"; message: string }> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен." };
  const member = await requireSession();
  const parsed = workflowResourceSearchSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректный запрос." };
  try { return { status: "success", options: await findWorkflowResources(member, parsed.data.mapId, parsed.data.kind, parsed.data.query) }; }
  catch (error) { return { status: "error", message: failure(error, "workflow.resource.search", member.memberId).message }; }
}

export async function getWorkflowCommentsAction(input: WorkflowCommentPageInput): Promise<{ status: "success"; page: WorkflowCommentPage } | { status: "error"; message: string }> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен." };
  const member = await requireSession();
  const parsed = workflowCommentPageSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректная страница комментариев." };
  try { return { status: "success", page: await listWorkflowComments(member, parsed.data.mapId, parsed.data.beforeId) }; }
  catch (error) { return { status: "error", message: failure(error, "workflow.comment.page", member.memberId).message }; }
}

export async function watchWorkflowMapAction(input: WatchWorkflowMapInput): Promise<WorkflowActionResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен.", id: null, version: null };
  const member = await requireSession();
  const parsed = watchWorkflowMapSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Некорректные данные карты.", id: null, version: null };
  try {
    await watchWorkflowMap(member, parsed.data.mapId, parsed.data.watching);
    revalidatePath("/workflow");
    return { status: "success", message: parsed.data.watching ? "Вы следите за изменениями карты." : "Слежение за картой отключено.", id: parsed.data.mapId, version: null };
  } catch (error) { return failure(error, "workflow.watch", member.memberId); }
}

export async function previewWorkflowAutomationAction(input: PreviewWorkflowAutomationInput): Promise<
  { status: "success"; preview: WorkflowAutomationPreview } | { status: "error"; message: string }
> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр недоступен." };
  const member = await requireSession();
  const parsed = previewWorkflowAutomationSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "Выберите опубликованную карту и заказ." };
  try {
    return { status: "success", preview: await previewOrderCreatedAutomation(member, parsed.data.mapId, parsed.data.orderId) };
  } catch (error) {
    if (error instanceof WorkflowAutomationPlanError) return { status: "error", message: "Схема запуска: одно событие «Создан заказ» соедините напрямую с 1–5 действиями «Создать задачу». Остальные блоки могут оставаться описанием." };
    if (error instanceof WorkflowAutomationTargetError) {
      const messages = { unpublished: "Сначала согласуйте и опубликуйте карту.",
        order_unavailable: "Заказ недоступен или отменён.", assignee_unavailable: "Исполнитель задачи отключён или недоступен." };
      return { status: "error", message: messages[error.reason] };
    }
    return { status: "error", message: failure(error, "workflow.automation.preview", member.memberId).message };
  }
}
