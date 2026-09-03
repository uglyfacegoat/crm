"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createMaster,
  MasterConflictError,
  MasterHasFutureVisitsError,
  MasterNotFoundError,
  MasterVersionConflictError,
  updateMaster,
} from "@/server/masters/repository";
import { createMasterSchema, updateMasterSchema } from "@/server/masters/schemas";

export type MasterMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

const previewState: MasterMutationState = {
  status: "error",
  message: "Предпросмотр не записывает данные. Для сохранения включите рабочий режим и PostgreSQL.",
  fieldErrors: {},
};

function fields(formData: FormData) {
  return {
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    messenger: formData.get("messenger"),
    serviceRegion: formData.get("serviceRegion"),
    serviceZone: formData.get("serviceZone"),
    basePaymentMinor: formData.get("basePayment"),
    dailyCapacity: formData.get("dailyCapacity"),
    skills: formData.get("skills"),
    notes: formData.get("notes"),
    operationalStatus: formData.get("operationalStatus"),
    workingDays: formData.getAll("workingDays"),
    statusUntil: formData.get("statusUntil"),
    statusNote: formData.get("statusNote"),
  };
}

function unexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function createMasterAction(_previous: MasterMutationState, formData: FormData): Promise<MasterMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = createMasterSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), ...fields(formData) });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await createMaster(member, parsed.data);
    revalidatePath("/masters");
    revalidatePath("/orders");
    return { status: "success", message: "Мастер добавлен.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof MasterConflictError) return { status: "error", message: "Мастер с таким телефоном уже есть.", fieldErrors: { phone: ["Телефон уже используется"] } };
    unexpected("masters.create", member.memberId, error);
    return { status: "error", message: "Не удалось добавить мастера. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function updateMasterAction(_previous: MasterMutationState, formData: FormData): Promise<MasterMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const member = await requireSession();
  const parsed = updateMasterSchema.safeParse({
    masterId: formData.get("masterId"),
    expectedVersion: formData.get("expectedVersion"),
    ...fields(formData),
    active: formData.get("operationalStatus") !== "terminated",
  });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await updateMaster(member, parsed.data);
    revalidatePath("/masters");
    revalidatePath("/orders");
    revalidatePath("/calendar");
    return { status: "success", message: "Карточка мастера обновлена.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof MasterConflictError) return { status: "error", message: "Мастер с таким телефоном уже есть.", fieldErrors: { phone: ["Телефон уже используется"] } };
    if (error instanceof MasterHasFutureVisitsError) return { status: "error", message: "У мастера есть будущие выезды. Сначала переназначьте или отмените их.", fieldErrors: { active: ["Деактивация недоступна"] } };
    if (error instanceof MasterVersionConflictError) return { status: "error", message: "Карточку уже изменил другой сотрудник. Закройте окно, обновите страницу и повторите.", fieldErrors: {} };
    if (error instanceof MasterNotFoundError) return { status: "error", message: "Мастер больше не существует или недоступен.", fieldErrors: {} };
    unexpected("masters.update", member.memberId, error);
    return { status: "error", message: "Не удалось обновить мастера. Изменения не сохранены.", fieldErrors: {} };
  }
}
