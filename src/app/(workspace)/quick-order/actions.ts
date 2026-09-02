"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createQuickOrder,
  QuickOrderConflictError,
  QuickOrderReferenceError,
  QuickOrderScheduleConflictError,
} from "@/server/quick-order/repository";
import { quickOrderSchema } from "@/server/quick-order/schemas";
import type { QuickOrderResult } from "@/server/quick-order/types";

export type QuickOrderState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  result: QuickOrderResult | null;
};

function parsePayload(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return { success: false as const };
  try {
    return { success: true as const, value: JSON.parse(value) as unknown };
  } catch {
    return { success: false as const };
  }
}

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(memberId: string, error: unknown) {
  console.error(JSON.stringify({
    operation: "quick_orders.create",
    category: "unexpected",
    memberId,
    error: error instanceof Error ? error.message : "Unknown error",
  }));
}

export async function createQuickOrderAction(_previous: QuickOrderState, formData: FormData): Promise<QuickOrderState> {
  if (getAuthMode() === "preview") {
    return { status: "error", message: "Предпросмотр не записывает данные. Войдите в рабочую CRM.", fieldErrors: {}, result: null };
  }
  const member = await requireSession();
  const payload = parsePayload(formData.get("payload"));
  if (!payload.success) {
    return { status: "error", message: "Форма повреждена. Обновите страницу и повторите.", fieldErrors: {}, result: null };
  }
  const parsed = quickOrderSchema.safeParse(payload.value);
  if (!parsed.success) {
    return { status: "error", message: "Проверьте обязательные поля на всех шагах.", fieldErrors: fieldErrors(parsed.error), result: null };
  }

  try {
    const result = await createQuickOrder(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/clients");
    revalidatePath(`/clients/${result.clientId}`);
    revalidatePath("/orders");
    revalidatePath(`/orders/${result.orderId}`);
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    return { status: "success", message: `${result.orderNumber} и первый выезд созданы.`, fieldErrors: {}, result };
  } catch (error) {
    if (error instanceof QuickOrderConflictError) {
      const messages = {
        client: "Клиент с таким ИНН уже существует.",
        contact: "Этот телефон уже записан у выбранного клиента.",
        object: "Объект с таким адресом уже существует у выбранного клиента.",
      } as const;
      return { status: "error", message: messages[error.field], fieldErrors: { client: [messages[error.field]] }, result: null };
    }
    if (error instanceof QuickOrderReferenceError) {
      const labels = { client: "Клиент", contact: "Контакт", object: "Объект", master: "Мастер" } as const;
      return { status: "error", message: `${labels[error.field]} больше не существует или недоступен. Обновите страницу.`, fieldErrors: {}, result: null };
    }
    if (error instanceof QuickOrderScheduleConflictError) {
      return { status: "error", message: "У мастера уже есть выезд в это время. Выберите другое время или мастера.", fieldErrors: { visit: ["Время пересекается с другим выездом"] }, result: null };
    }
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Недостаточно прав для полного оформления заказа и выезда.", fieldErrors: {}, result: null };
    }
    logUnexpected(member.memberId, error);
    return { status: "error", message: "Не удалось оформить заказ. Никакие изменения не сохранены.", fieldErrors: {}, result: null };
  }
}
