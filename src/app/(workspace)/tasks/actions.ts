"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { createTaskSchema, rescheduleTaskSchema, taskMutationSchema } from "@/server/tasks/schemas";
import { completeTask, createTask, rescheduleTask, TaskNotFoundError, TaskVersionConflictError } from "@/server/tasks/repository";
import type { TaskColumn } from "@/server/tasks/types";

export type CreateTaskState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  taskId: string | null;
};

export type TaskMutationResult = { status: "success" | "error"; message: string; version: number | null };

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function createTaskAction(_previous: CreateTaskState, formData: FormData): Promise<CreateTaskState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не записывает задачи.", fieldErrors: {}, taskId: null };
  const member = await requireSession();
  const parsed = createTaskSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    title: formData.get("title"),
    description: formData.get("description"),
    priority: formData.get("priority"),
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
    logUnexpected("task.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать задачу. Данные не сохранены.", fieldErrors: {}, taskId: null };
  }
}

function mutationFailure(error: unknown): TaskMutationResult | null {
  if (error instanceof TaskNotFoundError) return { status: "error", message: "Задача больше не существует или недоступна.", version: null };
  if (error instanceof TaskVersionConflictError) return { status: "error", message: "Задачу уже изменил другой сотрудник. Доска будет обновлена.", version: null };
  return null;
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
