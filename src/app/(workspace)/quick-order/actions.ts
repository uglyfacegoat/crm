"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/permissions";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  createQuickOrder,
  QuickOrderConflictError,
  QuickOrderLeadConflictError,
  QuickOrderReferenceError,
  QuickOrderScheduleConflictError,
} from "@/server/quick-order/repository";
import { quickOrderSchema } from "@/server/quick-order/schemas";
import type { QuickOrderResult } from "@/server/quick-order/types";
import { createMinimalOrder, minimalOrderSchema } from "@/server/quick-order/minimal";
import { createFlexibleOrder, FlexibleOrderConflictError, FlexibleOrderLeadConflictError, FlexibleOrderReferenceError, FlexibleOrderScheduleConflictError } from "@/server/quick-order/flexible-repository";
import { flexibleOrderSchema } from "@/server/quick-order/flexible-schemas";
import { getDatabase } from "@/server/database";

export type MinimalOrderState = { status: "idle" | "success" | "error"; message: string | null; orderId: string | null; fieldErrors: Record<string, string[]> };

export async function createMinimalOrderAction(_previous: MinimalOrderState, formData: FormData): Promise<MinimalOrderState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет заказы.", orderId: null, fieldErrors: {} };
  const member = await requireSession();
  const parsed = minimalOrderSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    clientKind: formData.get("clientKind"),
    clientName: formData.get("clientName"),
    phone: formData.get("phone"),
    price: formData.get("price"),
    existingClientId: formData.get("existingClientId") ?? "",
    existingContactId: formData.get("existingContactId") ?? "",
    contactName: formData.get("contactName") ?? "",
    contactPosition: formData.get("contactPosition") ?? "",
    email: formData.get("email") ?? "",
    taxId: formData.get("taxId") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { status: "error", message: "Укажите имя или название заказчика и проверьте заполненные поля.", orderId: null, fieldErrors: fieldErrors(parsed.error) };
  try {
    const orderId = await createMinimalOrder(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/clients");
    revalidatePath("/orders");
    return { status: "success", message: "Заказ создан. Остальные сведения можно заполнить в карточке.", orderId, fieldErrors: {} };
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для оформления заказа.", orderId: null, fieldErrors: {} };
    logUnexpected(member.memberId, error);
    return { status: "error", message: "Не удалось сохранить заказ. Попробуйте ещё раз.", orderId: null, fieldErrors: {} };
  }
}

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
    errorCode: safeErrorCode(error),
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
    revalidatePath("/inbox");
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
      const labels = { client: "Клиент", contact: "Контакт", object: "Объект", master: "Мастер", catalog: "Позиция каталога" } as const;
      return { status: "error", message: `${labels[error.field]} больше не существует или недоступен. Обновите страницу.`, fieldErrors: {}, result: null };
    }
    if (error instanceof QuickOrderScheduleConflictError) {
      return { status: "error", message: "У мастера уже есть выезд в это время. Выберите другое время или мастера.", fieldErrors: { visit: ["Время пересекается с другим выездом"] }, result: null };
    }
    if (error instanceof QuickOrderLeadConflictError) {
      return { status: "error", message: "Входящая заявка уже обработана или изменилась. Вернитесь в очередь и откройте её заново.", fieldErrors: {}, result: null };
    }
    if (error instanceof AuthorizationError) {
      return { status: "error", message: "Недостаточно прав для полного оформления заказа и выезда.", fieldErrors: {}, result: null };
    }
    logUnexpected(member.memberId, error);
    return { status: "error", message: "Не удалось оформить заказ. Никакие изменения не сохранены.", fieldErrors: {}, result: null };
  }
}

export async function createUnifiedOrderAction(_previous: QuickOrderState, formData: FormData): Promise<QuickOrderState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет заказы.", fieldErrors: {}, result: null };
  const member = await requireSession();
  const payload = parsePayload(formData.get("payload"));
  if (!payload.success) return { status: "error", message: "Форма повреждена. Обновите страницу.", fieldErrors: {}, result: null };
  const parsed = flexibleOrderSchema.safeParse(payload.value);
  if (!parsed.success) return { status: "error", message: "Проверьте заполненные поля. Для заказа достаточно имени заказчика.", fieldErrors: fieldErrors(parsed.error), result: null };
  try {
    const orderId = await createFlexibleOrder(member, parsed.data);
    const [row] = await getDatabase()`SELECT orders.order_number, orders.client_id, orders.object_id, orders.client_contact_id,
      (SELECT id FROM service_visits WHERE organization_id = orders.organization_id AND order_id = orders.id ORDER BY created_at LIMIT 1) AS visit_id
      FROM orders WHERE organization_id = ${member.organizationId} AND id = ${orderId}`;
    if (!row) throw new Error("Created order is unavailable.");
    for (const path of ["/", "/clients", `/clients/${row.client_id}`, "/orders", `/orders/${orderId}`, "/calendar", "/tasks", "/inbox"]) revalidatePath(path);
    return { status: "success", message: "Заказ создан.", fieldErrors: {}, result: {
      orderId, orderNumber: String(row.order_number), clientId: String(row.client_id),
      objectId: row.object_id === null ? null : String(row.object_id),
      contactId: row.client_contact_id === null ? null : String(row.client_contact_id),
      visitId: row.visit_id === null ? null : String(row.visit_id),
    } };
  } catch (error) {
    if (error instanceof FlexibleOrderConflictError) return { status: "error", message: "Такой ИНН, телефон или адрес уже есть. Проверьте данные.", fieldErrors: {}, result: null };
    if (error instanceof FlexibleOrderReferenceError) return { status: "error", message: "Выбранный клиент, объект, мастер или услуга недоступны. Обновите страницу.", fieldErrors: {}, result: null };
    if (error instanceof FlexibleOrderLeadConflictError) return { status: "error", message: "Входящая заявка уже обработана или изменилась. Откройте её заново.", fieldErrors: {}, result: null };
    if (error instanceof FlexibleOrderScheduleConflictError) return { status: "error", message: "У мастера уже есть выезд в это время. Выберите другое время или мастера.", fieldErrors: {}, result: null };
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для оформления заказа.", fieldErrors: {}, result: null };
    logUnexpected(member.memberId, error);
    return { status: "error", message: "Не удалось оформить заказ. Данные не изменены.", fieldErrors: {}, result: null };
  }
}
