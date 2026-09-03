"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { createSupportRequest, SupportRequestLimitError } from "@/server/support/repository";
import { createSupportRequestSchema } from "@/server/support/schemas";

export type SupportMutationState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]> };

export async function createSupportRequestAction(_previous: SupportMutationState, formData: FormData): Promise<SupportMutationState> {
  const member = await requireSession();
  const parsed = createSupportRequestSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), category: formData.get("category"), subject: formData.get("subject"), description: formData.get("description") });
  if (!parsed.success) return { status: "error", message: "Проверьте тему и подробное описание.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await createSupportRequest(member, parsed.data);
    revalidatePath("/help");
    return { status: "success", message: "Обращение зарегистрировано. Оно появилось в вашей истории.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof SupportRequestLimitError) return { status: "error", message: "У вас уже 10 открытых обращений. Дождитесь ответа администратора.", fieldErrors: {} };
    console.error(JSON.stringify({ operation: "support.request.create", category: "unexpected", memberId: member.memberId, error: error instanceof Error ? error.message : "Unknown error" }));
    return { status: "error", message: "Не удалось зарегистрировать обращение. Данные не сохранены.", fieldErrors: {} };
  }
}
