"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import {
  createOrganizationUnit,
  OrganizationAccessError,
  OrganizationUnitConflictError,
  OrganizationUnitHierarchyError,
} from "@/server/organizations/repository";
import { createOrganizationUnitSchema } from "@/server/organizations/schemas";

export type OrganizationUnitActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

export async function createOrganizationUnitAction(
  _previous: OrganizationUnitActionState,
  formData: FormData,
): Promise<OrganizationUnitActionState> {
  const member = await requireOfficeSession();
  if (getAuthMode() !== "required") {
    return {
      status: "error",
      message: "В режиме предпросмотра структура компании не изменяется.",
    };
  }

  const parsed = createOrganizationUnitSchema.safeParse({
    organizationId: formData.get("organizationId"),
    parentUnitId: formData.get("parentUnitId"),
    kind: formData.get("kind"),
    name: formData.get("name"),
    address: formData.get("address"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message:
        parsed.error.issues[0]?.message ?? "Проверьте данные подразделения.",
    };
  }

  try {
    await createOrganizationUnit(member, parsed.data);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Недостаточно прав для изменения структуры компании." };
    }
    if (error instanceof OrganizationUnitConflictError) {
      return {
        status: "error",
        message: "На этом уровне уже есть подразделение с таким названием.",
      };
    }
    if (error instanceof OrganizationUnitHierarchyError) {
      return { status: "error", message: "Выбранный город больше недоступен." };
    }
    if (error instanceof OrganizationAccessError) {
      return {
        status: "error",
        message: "Структуру можно менять только у текущей компании.",
      };
    }
    console.error(
      JSON.stringify({
        operation: "organization-unit.create",
        actorId: member.memberId,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return {
      status: "error",
      message: "Не удалось сохранить подразделение. Попробуйте ещё раз.",
    };
  }

  revalidatePath("/companies");
  return { status: "success", message: "Подразделение добавлено." };
}
