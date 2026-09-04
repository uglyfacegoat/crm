"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { IncomingLeadConflictError, rejectIncomingLead } from "@/server/incoming-leads/repository";
import { rejectIncomingLeadSchema } from "@/server/incoming-leads/schemas";

export type IncomingLeadMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

export async function rejectIncomingLeadAction(
  _previous: IncomingLeadMutationState,
  formData: FormData,
): Promise<IncomingLeadMutationState> {
  if (getAuthMode() === "preview") {
    return { status: "error", message: "Предпросмотр не изменяет входящие заявки.", fieldErrors: {} };
  }
  const member = await requireSession();
  const parsed = rejectIncomingLeadSchema.safeParse({
    leadId: formData.get("leadId"),
    expectedVersion: formData.get("expectedVersion"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Укажите понятную причину отклонения.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  try {
    await rejectIncomingLead(member, parsed.data);
    revalidatePath("/inbox");
    revalidatePath("/sites");
    return { status: "success", message: "Заявка отклонена и сохранена в истории.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof IncomingLeadConflictError) {
      return { status: "error", message: "Заявку уже обработал другой сотрудник. Обновите страницу.", fieldErrors: {} };
    }
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Недостаточно прав для обработки заявки.", fieldErrors: {} };
    }
    console.error(JSON.stringify({
      operation: "website_lead.reject",
      category: "unexpected",
      actorId: member.memberId,
      leadId: parsed.data.leadId,
      error: error instanceof Error ? error.message : "Unknown error",
    }));
    return { status: "error", message: "Не удалось отклонить заявку. Изменения не сохранены.", fieldErrors: {} };
  }
}

