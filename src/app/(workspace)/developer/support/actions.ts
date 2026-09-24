"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import {
  SupportRequestNotFoundError,
  SupportRequestVersionConflictError,
  updateSupportRequestStatus,
} from "@/server/support/repository";
import { updateSupportRequestStatusSchema } from "@/server/support/schemas";

export type SupportStatusMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

export async function updateSupportRequestStatusAction(
  _previous: SupportStatusMutationState,
  formData: FormData,
): Promise<SupportStatusMutationState> {
  const member = await requireSession();
  const parsed = updateSupportRequestStatusSchema.safeParse({
    requestId: formData.get("requestId"),
    expectedVersion: formData.get("expectedVersion"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Карточка обращения устарела. Обновите страницу." };
  }

  try {
    await updateSupportRequestStatus(member, parsed.data);
    revalidatePath("/developer/support");
    revalidatePath("/help");
    return { status: "success", message: "Статус сохранён." };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Раздел доступен только системному разработчику." };
    }
    if (error instanceof SupportRequestNotFoundError) {
      return { status: "error", message: "Обращение больше не существует." };
    }
    if (error instanceof SupportRequestVersionConflictError) {
      return { status: "error", message: "Обращение уже изменилось. Обновите страницу." };
    }
    console.error(JSON.stringify({
      operation: "support.request.status_update",
      category: "unexpected",
      memberId: member.memberId,
      errorCode: safeErrorCode(error),
    }));
    return { status: "error", message: "Не удалось сохранить статус." };
  }
}
