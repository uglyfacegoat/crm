"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import {
  ClientConflictError, ClientContactConflictError, ClientNotFoundError, ClientObjectConflictError,
  ClientVersionConflictError, createClient, createClientContact, createClientObject, updateClient,
} from "@/server/clients/repository";
import { createClientContactSchema, createClientObjectSchema, createClientSchema, updateClientSchema } from "@/server/clients/schemas";

export type CreateClientState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]>; clientId: string | null };
export type ClientMutationState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]> };

const previewState: ClientMutationState = { status: "error", message: "Предпросмотр не записывает данные. Для сохранения включите рабочий режим и PostgreSQL.", fieldErrors: {} };

function logUnexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, errorCode: safeErrorCode(error) }));
}

export async function createClientAction(_previous: CreateClientState, formData: FormData): Promise<CreateClientState> {
  if (getAuthMode() === "preview") return { status: "error", message: "В предпросмотре окно работает без записи. Для сохранения включите AUTH_MODE=required и PostgreSQL.", fieldErrors: {}, clientId: null };
  const parsed = createClientSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), kind: formData.get("kind"), legalName: formData.get("legalName"), taxId: formData.get("taxId"), contactName: formData.get("contactName"), contactPosition: formData.get("contactPosition"), phone: formData.get("phone"), email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors, clientId: null };
  const member = await requireSession();
  try {
    const clientId = await createClient(member, parsed.data);
    revalidatePath("/clients");
    return { status: "success", message: "Клиент создан.", fieldErrors: {}, clientId };
  } catch (error) {
    if (error instanceof ClientConflictError) return { status: "error", message: "Клиент с таким ИНН уже существует.", fieldErrors: { taxId: ["ИНН уже используется"] }, clientId: null };
    console.error(JSON.stringify({ operation: "clients.create", category: "unexpected", memberId: member.memberId, errorCode: safeErrorCode(error) }));
    return { status: "error", message: "Не удалось создать клиента. Изменения не сохранены.", fieldErrors: {}, clientId: null };
  }
}

export async function updateClientAction(_previous: ClientMutationState, formData: FormData): Promise<ClientMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const parsed = updateClientSchema.safeParse({ clientId: formData.get("clientId"), expectedVersion: formData.get("expectedVersion"), kind: formData.get("kind"), legalName: formData.get("legalName"), taxId: formData.get("taxId") });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  const member = await requireSession();
  try {
    await updateClient(member, parsed.data);
    revalidatePath("/clients");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { status: "success", message: "Карточка обновлена.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof ClientConflictError) return { status: "error", message: "Клиент с таким ИНН уже существует.", fieldErrors: { taxId: ["ИНН уже используется"] } };
    if (error instanceof ClientVersionConflictError) return { status: "error", message: "Карточку уже изменил другой сотрудник. Закройте окно, обновите страницу и повторите.", fieldErrors: {} };
    if (error instanceof ClientNotFoundError) return { status: "error", message: "Клиент больше не существует или недоступен.", fieldErrors: {} };
    logUnexpected("clients.update", member.memberId, error);
    return { status: "error", message: "Не удалось обновить клиента. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function createClientContactAction(_previous: ClientMutationState, formData: FormData): Promise<ClientMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const parsed = createClientContactSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), clientId: formData.get("clientId"), fullName: formData.get("fullName"), position: formData.get("position"), phone: formData.get("phone"), email: formData.get("email"), isPrimary: formData.get("isPrimary") === "on" });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  const member = await requireSession();
  try {
    await createClientContact(member, parsed.data);
    revalidatePath("/clients");
    revalidatePath(`/clients/${parsed.data.clientId}`);
    return { status: "success", message: "Контакт добавлен.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof ClientContactConflictError) return { status: "error", message: "Этот телефон уже добавлен клиенту.", fieldErrors: { phone: ["Контакт с таким телефоном уже существует"] } };
    if (error instanceof ClientNotFoundError) return { status: "error", message: "Клиент больше не существует или недоступен.", fieldErrors: {} };
    logUnexpected("client_contacts.create", member.memberId, error);
    return { status: "error", message: "Не удалось добавить контакт. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function createClientObjectAction(_previous: ClientMutationState, formData: FormData): Promise<ClientMutationState> {
  if (getAuthMode() === "preview") return previewState;
  const parsed = createClientObjectSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), clientId: formData.get("clientId"), name: formData.get("name"), objectType: formData.get("objectType"), address: formData.get("address"), areaSquareMeters: formData.get("areaSquareMeters"), floorCount: formData.get("floorCount"), onsiteContact: formData.get("onsiteContact"), accessInstructions: formData.get("accessInstructions"), parkingNotes: formData.get("parkingNotes"), restrictions: formData.get("restrictions"), riskLevel: formData.get("riskLevel"), infestationLevel: formData.get("infestationLevel") });
  if (!parsed.success) return { status: "error", message: "Проверьте обязательные поля.", fieldErrors: parsed.error.flatten().fieldErrors };
  const member = await requireSession();
  try {
    await createClientObject(member, parsed.data);
    revalidatePath(`/clients/${parsed.data.clientId}`);
    revalidatePath("/clients");
    return { status: "success", message: "Объект добавлен.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof ClientObjectConflictError) return { status: "error", message: "У клиента уже есть объект с таким адресом.", fieldErrors: { address: ["Адрес уже используется"] } };
    if (error instanceof ClientNotFoundError) return { status: "error", message: "Клиент больше не существует или недоступен.", fieldErrors: {} };
    logUnexpected("client_objects.create", member.memberId, error);
    return { status: "error", message: "Не удалось добавить объект. Изменения не сохранены.", fieldErrors: {} };
  }
}
