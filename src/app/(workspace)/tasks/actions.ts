"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { cancelTaskSchema, createTaskSchema, rescheduleTaskSchema, taskMutationSchema, updateTaskSchema } from "@/server/tasks/schemas";
import { cancelTask, completeTask, createTask, listTaskHistory, rescheduleTask, TaskAssigneeNotFoundError, TaskManagedByVisitError, TaskNotFoundError, TaskOrderNotFoundError, TaskVersionConflictError, updateTask } from "@/server/tasks/repository";
import type { TaskColumn, TaskHistoryFeed } from "@/server/tasks/types";

export type CreateTaskState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  taskId: string | null;
};

export type TaskMutationResult = { status: "success" | "error"; message: string; version: number | null };
export type UpdateTaskState = CreateTaskState;
export type TaskHistoryResult = { status: "success"; feed: TaskHistoryFeed } | { status: "error"; message: string };

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, errorCode: safeErrorCode(error) }));
}

export async function createTaskAction(_previous: CreateTaskState, formData: FormData): Promise<CreateTaskState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", fieldErrors: {}, taskId: null };
  const member = await requireSession();
  const parsed = createTaskSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    relatedOrderId: formData.get("relatedOrderId"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
    assignedMemberId: formData.get("assignedMemberId"),
    localDate: formData.get("localDate"),
    localTime: formData.get("localTime"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте название и срок задачи.", fieldErrors: fieldErrors(parsed.error), taskId: null };
  try {
    const taskId = await createTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return { status: "success", message: "Задача создана.", fieldErrors: {}, taskId };
  } catch (error) {
    if (error instanceof TaskAssigneeNotFoundError) return { status: "error", message: "Выбранный сотрудник отключён или больше не существует.", fieldErrors: { assignedMemberId: ["Выберите активного сотрудника"] }, taskId: null };
    if (error instanceof TaskOrderNotFoundError) return { status: "error", message: "Выбранный заказ закрыт или больше не существует.", fieldErrors: { relatedOrderId: ["Выберите доступный заказ"] }, taskId: null };
    logUnexpected("task.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать задачу. Данные не сохранены.", fieldErrors: {}, taskId: null };
  }
}

function mutationFailure(error: unknown): TaskMutationResult | null {
  if (error instanceof TaskNotFoundError) return { status: "error", message: "Задача больше не существует или недоступна.", version: null };
  if (error instanceof TaskVersionConflictError) return { status: "error", message: "Задачу уже изменил другой сотрудник. Доска будет обновлена.", version: null };
  if (error instanceof TaskManagedByVisitError) return { status: "error", message: "Срок и отмена автоматической задачи управляются через связанный выезд.", version: null };
  if (error instanceof TaskAssigneeNotFoundError) return { status: "error", message: "Выбранный сотрудник отключён или больше не существует.", version: null };
  return null;
}

export async function updateTaskAction(_previous: UpdateTaskState, formData: FormData): Promise<UpdateTaskState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", fieldErrors: {}, taskId: null };
  const member = await requireSession();
  const parsed = updateTaskSchema.safeParse({
    taskId: formData.get("taskId"),
    expectedVersion: formData.get("expectedVersion"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
    assignedMemberId: formData.get("assignedMemberId"),
    localDate: formData.get("localDate"),
    localTime: formData.get("localTime"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте поля задачи.", fieldErrors: fieldErrors(parsed.error), taskId: null };
  try {
    await updateTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return { status: "success", message: "Изменения сохранены.", fieldErrors: {}, taskId: parsed.data.taskId };
  } catch (error) {
    const known = mutationFailure(error);
    if (known) return { status: "error", message: known.message, fieldErrors: {}, taskId: null };
    logUnexpected("task.update", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить задачу.", fieldErrors: {}, taskId: null };
  }
}

export async function cancelTaskAction(taskId: string, expectedVersion: number, reason: string): Promise<TaskMutationResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", version: null };
  const member = await requireSession();
  const parsed = cancelTaskSchema.safeParse({ taskId, expectedVersion, reason });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Проверьте причину отмены.", version: null };
  try {
    const version = await cancelTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return { status: "success", message: "Задача отменена.", version };
  } catch (error) {
    const known = mutationFailure(error);
    if (known) return known;
    logUnexpected("task.cancel", member.memberId, error);
    return { status: "error", message: "Не удалось отменить задачу.", version: null };
  }
}

export async function getTaskHistoryAction(taskId: string): Promise<TaskHistoryResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "История недоступна в режиме предпросмотра." };
  const member = await requireSession();
  const parsed = taskMutationSchema.shape.taskId.safeParse(taskId);
  if (!parsed.success) return { status: "error", message: "Некорректный идентификатор задачи." };
  try {
    return { status: "success", feed: await listTaskHistory(member, parsed.data) };
  } catch (error) {
    if (error instanceof TaskNotFoundError) return { status: "error", message: "Задача больше не существует или недоступна." };
    logUnexpected("task.history", member.memberId, error);
    return { status: "error", message: "Не удалось загрузить историю задачи." };
  }
}

export async function completeTaskAction(taskId: string, expectedVersion: number): Promise<TaskMutationResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", version: null };
  const member = await requireSession();
  const parsed = taskMutationSchema.safeParse({ taskId, expectedVersion });
  if (!parsed.success) return { status: "error", message: "Некорректные данные задачи.", version: null };
  try {
    const version = await completeTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return { status: "success", message: "Задача выполнена.", version };
  } catch (error) {
    const known = mutationFailure(error);
    if (known) return known;
    logUnexpected("task.complete", member.memberId, error);
    return { status: "error", message: "Не удалось завершить задачу.", version: null };
  }
}

export async function rescheduleTaskAction(taskId: string, expectedVersion: number, column: TaskColumn): Promise<TaskMutationResult> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", version: null };
  const member = await requireSession();
  const parsed = rescheduleTaskSchema.safeParse({ taskId, expectedVersion, column });
  if (!parsed.success) return { status: "error", message: "Некорректные данные переноса.", version: null };
  try {
    const version = await rescheduleTask(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/tasks");
    return { status: "success", message: "Срок задачи изменён.", version };
  } catch (error) {
    const known = mutationFailure(error);
    if (known) return known;
    logUnexpected("task.reschedule", member.memberId, error);
    return { status: "error", message: "Не удалось перенести задачу.", version: null };
  }
}
