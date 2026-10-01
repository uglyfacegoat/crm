"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthorizationError, hasPermission, requirePermission } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { IncomingLeadConflictError, IncomingLeadNotFoundError, getIncomingLeadPrefill, rejectIncomingLead } from "@/server/incoming-leads/repository";
import { rejectIncomingLeadSchema } from "@/server/incoming-leads/schemas";
import { listOrderCreationOptions } from "@/server/orders/repository";

export async function prepareIncomingLeadOrderAction(leadId: string) {
  const member = await requireSession();
  try {
    requirePermission(member, "leads.write");
    requirePermission(member, "clients.write");
    requirePermission(member, "orders.write");
    if (getAuthMode() === "preview") return { error: "Предпросмотр не сохраняет заказы." };
    const id = z.string().uuid().parse(leadId);
    const prefill = await getIncomingLeadPrefill(member, id);
    const options = await listOrderCreationOptions(member, prefill.possibleClientId ?? undefined);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const parts = Object.fromEntries(date.map((part) => [part.type, part.value]));
    return { data: { prefill, options, idempotencyKey: randomUUID(), defaultVisitDate: `${parts.year}-${parts.month}-${parts.day}`, canScheduleVisit: hasPermission(member, "visits.write"), canWriteFinance: hasPermission(member, "finance.write") } };
  } catch (error) {
    if (error instanceof AuthorizationError) return { error: "Для оформления нужны права на заявки, клиентов и заказы." };
    if (error instanceof IncomingLeadNotFoundError) return { error: "Заявка уже обработана или недоступна. Обновите список." };
    console.error(JSON.stringify({ operation: "inbox.prepare_order", errorCode: safeErrorCode(error) }));
    return { error: "Не удалось открыть оформление. Попробуйте ещё раз." };
  }
}

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
      errorCode: safeErrorCode(error),
    }));
    return { status: "error", message: "Не удалось отклонить заявку. Изменения не сохранены.", fieldErrors: {} };
  }
}
