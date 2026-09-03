"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { configureWebsiteIntegration, createWebsite, updateWebsiteInfrastructure, WebsiteDomainConflictError, WebsiteIntegrationConflictError, WebsiteNotFoundError, WebsiteVersionConflictError } from "@/server/sites/repository";
import { configureWebsiteIntegrationSchema, createWebsiteSchema, updateWebsiteInfrastructureSchema } from "@/server/sites/schemas";

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

export async function updateWebsiteInfrastructureAction(_previous: WebsiteMutationState, formData: FormData): Promise<WebsiteMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не сохраняет инфраструктуру.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = updateWebsiteInfrastructureSchema.safeParse({
    websiteId: formData.get("websiteId"), expectedVersion: formData.get("expectedVersion"), status: formData.get("status"),
    hostingProvider: formData.get("hostingProvider"), planName: formData.get("planName"), serverRegion: formData.get("serverRegion"),
    monthlyCostMinor: formData.get("monthlyCost"), renewalOn: formData.get("renewalOn"), sslExpiresOn: formData.get("sslExpiresOn"),
    diskCapacityMb: formData.get("diskCapacityMb"), memoryCapacityMb: formData.get("memoryCapacityMb"), notes: formData.get("notes"),
    healthStatus: formData.get("healthStatus"), uptimePercent: formData.get("uptimePercent"), responseTimeMs: formData.get("responseTimeMs"),
    cpuLoadPercent: formData.get("cpuLoadPercent"), memoryUsedMb: formData.get("memoryUsedMb"), diskUsedMb: formData.get("diskUsedMb"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте параметры хостинга и нагрузки.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await updateWebsiteInfrastructure(member, parsed.data);
    revalidatePath("/sites");
    revalidatePath(`/sites/${parsed.data.websiteId}`);
    return { status: "success", message: "Инфраструктура и текущая проверка сайта сохранены.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof WebsiteNotFoundError) return { status: "error", message: "Сайт больше недоступен.", fieldErrors: {} };
    if (error instanceof WebsiteVersionConflictError) return { status: "error", message: "Сайт изменил другой сотрудник. Обновите страницу.", fieldErrors: {} };
    unexpected("website.infrastructure_update", member.memberId, error);
    return { status: "error", message: "Не удалось сохранить инфраструктуру.", fieldErrors: {} };
  }
}
