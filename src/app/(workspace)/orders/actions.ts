"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  addOrderExpense,
  createOrder,
  OrderNotFoundError,
  OrderReferenceError,
  OrderVersionConflictError,
  updateOrder,
} from "@/server/orders/repository";
import {
  linkOrders,
  OrderRelationClientMismatchError,
  OrderRelationNotFoundError,
} from "@/server/orders/relations-repository";
import { linkOrderSchema } from "@/server/orders/relation-schemas";
import { addOrderExpenseSchema, createOrderSchema, updateOrderSchema } from "@/server/orders/schemas";

export type CreateOrderState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
  orderId: string | null;
};

export type OrderMutationState = {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors: Record<string, string[]>;
};

const previewMutationState: OrderMutationState = {
  status: "error",
  message: "Предпросмотр не записывает данные. Для сохранения включите рабочий режим и PostgreSQL.",
  fieldErrors: {},
};

function parseJsonField(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function fieldErrors(error: { flatten(): { fieldErrors: Record<string, string[] | undefined> } }) {
  return Object.fromEntries(Object.entries(error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({
    operation,
    category: "unexpected",
    memberId,
    error: error instanceof Error ? error.message : "Unknown error",
  }));
}

function referenceMessage(error: OrderReferenceError) {
  const labels = { client: "Клиент", object: "Объект", contact: "Контакт", master: "Мастер" } as const;
  return `${labels[error.field]} больше не существует, недоступен или не относится к выбранному клиенту.`;
}

export async function createOrderAction(_previous: CreateOrderState, formData: FormData): Promise<CreateOrderState> {
  if (getAuthMode() === "preview") {
    return { ...previewMutationState, orderId: null };
  }
  const member = await requireSession();
  const parsed = createOrderSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    clientId: formData.get("clientId"),
    objectId: formData.get("objectId"),
    contactId: formData.get("contactId"),
    assignedMasterId: formData.get("assignedMasterId"),
    masterPayment: formData.get("masterPayment") ?? "",
    notes: formData.get("notes"),
    services: parseJsonField(formData.get("services")),
    expenses: parseJsonField(formData.get("expenses")),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля и состав заказа.", fieldErrors: fieldErrors(parsed.error), orderId: null };
  try {
    const orderId = await createOrder(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/orders");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { status: "success", message: "Заказ создан.", fieldErrors: {}, orderId };
  } catch (error) {
    if (error instanceof OrderReferenceError) return { status: "error", message: referenceMessage(error), fieldErrors: { [`${error.field}Id`]: [referenceMessage(error)] }, orderId: null };
    logUnexpected("orders.create", member.memberId, error);
    return { status: "error", message: "Не удалось создать заказ. Изменения не сохранены.", fieldErrors: {}, orderId: null };
  }
}

export async function updateOrderAction(_previous: OrderMutationState, formData: FormData): Promise<OrderMutationState> {
  if (getAuthMode() === "preview") return previewMutationState;
  const member = await requireSession();
  const parsed = updateOrderSchema.safeParse({
    orderId: formData.get("orderId"),
    expectedVersion: formData.get("expectedVersion"),
    status: formData.get("status"),
    statusReason: formData.get("statusReason"),
    assignedMasterId: formData.get("assignedMasterId"),
    masterPayment: formData.get("masterPayment") ?? "",
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await updateOrder(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { status: "success", message: "Заказ обновлён.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof OrderVersionConflictError) return { status: "error", message: "Заказ уже изменил другой сотрудник. Закройте окно, обновите страницу и повторите.", fieldErrors: {} };
    if (error instanceof OrderNotFoundError) return { status: "error", message: "Заказ больше не существует или недоступен.", fieldErrors: {} };
    if (error instanceof OrderReferenceError) return { status: "error", message: referenceMessage(error), fieldErrors: { assignedMasterId: [referenceMessage(error)] } };
    logUnexpected("orders.update", member.memberId, error);
    return { status: "error", message: "Не удалось обновить заказ. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function addOrderExpenseAction(_previous: OrderMutationState, formData: FormData): Promise<OrderMutationState> {
  if (getAuthMode() === "preview") return previewMutationState;
  const member = await requireSession();
  const parsed = addOrderExpenseSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    orderId: formData.get("orderId"),
    category: formData.get("category"),
    amount: formData.get("amount"),
    occurredOn: formData.get("occurredOn"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте данные расхода.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await addOrderExpense(member, parsed.data);
    revalidatePath("/");
    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    return { status: "success", message: "Расход добавлен.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof OrderNotFoundError) return { status: "error", message: "Заказ больше не существует или недоступен.", fieldErrors: {} };
    logUnexpected("order_expenses.create", member.memberId, error);
    return { status: "error", message: "Не удалось добавить расход. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function linkOrderAction(_previous: OrderMutationState, formData: FormData): Promise<OrderMutationState> {
  if (getAuthMode() === "preview") return previewMutationState;
  const member = await requireSession();
  const parsed = linkOrderSchema.safeParse({
    orderId: formData.get("orderId"),
    relatedOrderId: formData.get("relatedOrderId"),
  });
  if (!parsed.success) return { status: "error", message: "Выберите другой заказ для связи.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await linkOrders(member, parsed.data);
    revalidatePath("/orders");
    revalidatePath(`/orders/${parsed.data.orderId}`);
    revalidatePath(`/orders/${parsed.data.relatedOrderId}`);
    return { status: "success", message: "Заказы связаны. Даты выездов объединены автоматически.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof OrderRelationClientMismatchError) return { status: "error", message: "Связывать можно только заказы одного клиента.", fieldErrors: {} };
    if (error instanceof OrderRelationNotFoundError) return { status: "error", message: "Один из заказов больше не существует или недоступен.", fieldErrors: {} };
    logUnexpected("order_groups.link", member.memberId, error);
    return { status: "error", message: "Не удалось связать заказы. Изменения не сохранены.", fieldErrors: {} };
  }
}
