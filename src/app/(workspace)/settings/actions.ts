"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createOrganizationMember,
  MemberIdentityConflictError,
  MemberMasterConflictError,
  MemberMasterNotFoundError,
  MemberNotFoundError,
  MemberSelfPasswordResetError,
  MemberSelfModificationError,
  MemberVersionConflictError,
  resetOrganizationMemberPassword,
  updateOrganizationMemberAccess,
} from "@/server/members/repository";
import { createMemberSchema, resetMemberPasswordSchema, updateMemberAccessSchema } from "@/server/members/schemas";

export type MemberMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

const previewState: MemberMutationState = {
  status: "error",
  message: "Предпросмотр не записывает сотрудников. Включите рабочий режим и PostgreSQL.",
  fieldErrors: {},
};

function accessFields(formData: FormData) {
  return {
    role: formData.get("role"),
    masterId: formData.get("masterId"),
  };
}

function unexpected(operation: string, actorId: string, error: unknown) {
  console.error(JSON.stringify({
    operation,
    category: "unexpected",
    actorId,
    error: error instanceof Error ? error.message : "Unknown error",
  }));
}

export async function createMemberAction(
  _previous: MemberMutationState,
  formData: FormData,
): Promise<MemberMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const actor = await requireSession();
  const parsed = createMemberSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    password: formData.get("password"),
    ...accessFields(formData),
  });
  if (!parsed.success) {
    return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await createOrganizationMember(actor, parsed.data);
    revalidatePath("/settings");
    revalidatePath("/chat");
    return { status: "success", message: "Учётная запись создана.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof MemberIdentityConflictError) {
      return { status: "error", message: "Этот e-mail или телефон уже используется.", fieldErrors: { email: ["Проверьте уникальность логина"] } };
    }
    if (error instanceof MemberMasterConflictError) {
      return { status: "error", message: "Карточка мастера уже привязана к другой учётной записи.", fieldErrors: { masterId: ["Выберите другого мастера"] } };
    }
    if (error instanceof MemberMasterNotFoundError) {
      return { status: "error", message: "Карточка мастера недоступна или деактивирована.", fieldErrors: { masterId: ["Обновите список мастеров"] } };
    }
    unexpected("organization_members.create", actor.memberId, error);
    return { status: "error", message: "Не удалось создать сотрудника. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function updateMemberAccessAction(
  _previous: MemberMutationState,
  formData: FormData,
): Promise<MemberMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const actor = await requireSession();
  const parsed = updateMemberAccessSchema.safeParse({
    memberId: formData.get("memberId"),
    expectedVersion: formData.get("expectedVersion"),
    active: formData.get("active") === "on",
    ...accessFields(formData),
  });
  if (!parsed.success) {
    return { status: "error", message: "Проверьте роль и привязку мастера.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await updateOrganizationMemberAccess(actor, parsed.data);
    revalidatePath("/settings");
    revalidatePath("/chat");
    return { status: "success", message: "Доступ сотрудника обновлён. Его активные сессии завершены.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof MemberSelfModificationError) {
      return { status: "error", message: "Нельзя менять собственную роль или отключать свою учётную запись.", fieldErrors: {} };
    }
    if (error instanceof MemberVersionConflictError) {
      return { status: "error", message: "Данные уже изменил другой администратор. Обновите страницу и повторите.", fieldErrors: {} };
    }
    if (error instanceof MemberNotFoundError) {
      return { status: "error", message: "Сотрудник больше не существует или недоступен.", fieldErrors: {} };
    }
    if (error instanceof MemberMasterConflictError) {
      return { status: "error", message: "Карточка мастера уже привязана к другой учётной записи.", fieldErrors: { masterId: ["Выберите другого мастера"] } };
    }
    if (error instanceof MemberMasterNotFoundError) {
      return { status: "error", message: "Карточка мастера недоступна или деактивирована.", fieldErrors: { masterId: ["Обновите список мастеров"] } };
    }
    unexpected("organization_members.access_update", actor.memberId, error);
    return { status: "error", message: "Не удалось обновить доступ. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function resetMemberPasswordAction(
  _previous: MemberMutationState,
  formData: FormData,
): Promise<MemberMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const actor = await requireSession();
  const parsed = resetMemberPasswordSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    memberId: formData.get("memberId"),
    expectedVersion: formData.get("expectedVersion"),
    password: formData.get("password"),
    passwordConfirmation: formData.get("passwordConfirmation"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Проверьте новый пароль и его подтверждение.", fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await resetOrganizationMemberPassword(actor, parsed.data);
    revalidatePath("/settings");
    return { status: "success", message: "Пароль заменён. Все активные сессии сотрудника завершены.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof MemberSelfPasswordResetError) {
      return { status: "error", message: "Собственный пароль меняется в разделе безопасности профиля.", fieldErrors: {} };
    }
    if (error instanceof MemberVersionConflictError) {
      return { status: "error", message: "Данные сотрудника уже изменились. Обновите страницу и повторите.", fieldErrors: {} };
    }
    if (error instanceof MemberNotFoundError) {
      return { status: "error", message: "Сотрудник больше не существует или недоступен.", fieldErrors: {} };
    }
    unexpected("organization_members.password_reset", actor.memberId, error);
    return { status: "error", message: "Не удалось заменить пароль. Изменения не сохранены.", fieldErrors: {} };
  }
}
