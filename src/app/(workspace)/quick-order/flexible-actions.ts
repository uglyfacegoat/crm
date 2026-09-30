"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { createFlexibleOrder, FlexibleOrderConflictError, FlexibleOrderReferenceError } from "@/server/quick-order/flexible-repository";
import { flexibleOrderSchema } from "@/server/quick-order/flexible-schemas";

export type FlexibleOrderState = { status: "idle" | "success" | "error"; message: string; orderId: string | null; fieldErrors: Record<string, string[]> };

export async function createFlexibleOrderAction(_previous: FlexibleOrderState, formData: FormData): Promise<FlexibleOrderState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет заказы.", orderId: null, fieldErrors: {} };
  const member = await requireSession();
  let payload: unknown;
  try { payload = JSON.parse(String(formData.get("payload"))); } catch { return { status: "error", message: "Форма повреждена. Обновите страницу.", orderId: null, fieldErrors: {} }; }
  const parsed = flexibleOrderSchema.safeParse(payload);
  if (!parsed.success) return { status: "error", message: "Проверьте заполненные поля. Для нового заказчика достаточно имени или названия.", orderId: null, fieldErrors: Object.fromEntries(Object.entries(parsed.error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))) };
  try {
    const orderId = await createFlexibleOrder(member, parsed.data);
    for (const path of ["/", "/clients", "/orders", `/orders/${orderId}`]) revalidatePath(path);
    return { status: "success", message: "Заказ создан.", orderId, fieldErrors: {} };
  } catch (error) {
    if (error instanceof FlexibleOrderConflictError) return { status: "error", message: "Такой ИНН, телефон или адрес уже есть у заказчика. Проверьте данные.", orderId: null, fieldErrors: {} };
    if (error instanceof FlexibleOrderReferenceError) return { status: "error", message: "Выбранный клиент, контакт, объект или позиция каталога недоступны. Обновите страницу.", orderId: null, fieldErrors: {} };
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для создания заказа.", orderId: null, fieldErrors: {} };
    console.error("quick_orders.create_flexible", error);
    return { status: "error", message: "Не удалось сохранить заказ. Данные не изменены.", orderId: null, fieldErrors: {} };
  }
}
