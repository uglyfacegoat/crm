"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { safeErrorCode } from "@/server/observability/safe-error";
import {
  archiveWorkflowMap, createWorkflowMap, saveWorkflowMap,
  WorkflowMapConflictError, WorkflowMapNotFoundError,
} from "@/server/workflow/repository";
import {
  archiveWorkflowMapSchema, createWorkflowMapSchema, saveWorkflowMapSchema,
  type ArchiveWorkflowMapInput, type CreateWorkflowMapInput, type SaveWorkflowMapInput,
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
  if (error instanceof WorkflowMapConflictError) return { status: "error", message: "Карту изменили в другой вкладке. Обновите страницу, чтобы увидеть актуальную версию.", id: null, version: null };
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
