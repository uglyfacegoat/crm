"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { configureWebsiteIntegration, createWebsite, WebsiteDomainConflictError, WebsiteIntegrationConflictError, WebsiteNotFoundError } from "@/server/sites/repository";
import { configureWebsiteIntegrationSchema, createWebsiteSchema } from "@/server/sites/schemas";

export type WebsiteMutationState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]> };

function unexpected(operation: string, memberId: string, error: unknown) {
  console.error(JSON.stringify({ operation, category: "unexpected", memberId, error: error instanceof Error ? error.message : "Unknown error" }));
}

export async function createWebsiteAction(_previous: WebsiteMutationState, formData: FormData): Promise<WebsiteMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не создаёт сайты.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = createWebsiteSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), name: formData.get("name"), domain: formData.get("domain") });
  if (!parsed.success) return { status: "error", message: "Проверьте название и домен.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await createWebsite(member, parsed.data);
    revalidatePath("/sites");
    return { status: "success", message: "Сайт добавлен в контур. Теперь подключите источник данных.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof WebsiteDomainConflictError) return { status: "error", message: "Этот домен уже добавлен в организацию.", fieldErrors: { domain: ["Домен должен быть уникальным"] } };
    unexpected("website.create", member.memberId, error);
    return { status: "error", message: "Не удалось добавить сайт. Изменения не сохранены.", fieldErrors: {} };
  }
}

export async function configureWebsiteIntegrationAction(_previous: WebsiteMutationState, formData: FormData): Promise<WebsiteMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет подключения.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = configureWebsiteIntegrationSchema.safeParse({ idempotencyKey: formData.get("idempotencyKey"), websiteId: formData.get("websiteId"), provider: formData.get("provider"), propertyId: formData.get("propertyId"), secretReference: formData.get("secretReference") });
  if (!parsed.success) return { status: "error", message: "Проверьте параметры подключения.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await configureWebsiteIntegration(member, parsed.data);
    revalidatePath("/sites");
    return { status: "success", message: "Подключение сохранено в статусе ожидания синхронизации.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof WebsiteIntegrationConflictError) return { status: "error", message: "Этот источник уже настроен для сайта.", fieldErrors: { provider: ["Выберите другой источник"] } };
    if (error instanceof WebsiteNotFoundError) return { status: "error", message: "Сайт недоступен или отключён.", fieldErrors: {} };
    unexpected("website.integration.configure", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить подключение.", fieldErrors: {} };
  }
}
