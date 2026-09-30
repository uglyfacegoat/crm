"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/server/auth/session";
import { hasPermission } from "@/server/auth/permissions";
import { listCenterCompanyScopes } from "@/server/organizations/center-dashboard";
import { z } from "zod";
import { CatalogConflictError, deleteCatalogItem, deleteCatalogUnit, saveCatalogItem, saveCatalogUnit, setCatalogItemActive } from "@/server/catalog/repository";
import { catalogArchiveSchema, catalogItemSchema } from "@/server/catalog/schemas";

export type CatalogActionState = { status: "idle" | "success" | "error"; message: string; fieldErrors: Record<string, string[]> };
const invalid = (message: string): CatalogActionState => ({ status: "error", message, fieldErrors: {} });
async function targetScope(member: Awaited<ReturnType<typeof requireSession>>, organizationId: string) {
  if (organizationId === member.organizationId) return member;
  if (!z.string().uuid().safeParse(organizationId).success) return null;
  if (!hasPermission(member, "companies.read")) return null;
  return (await listCenterCompanyScopes(member)).find((scope) => scope.organizationId === organizationId) ?? null;
}

export async function saveCatalogItemAction(_previous: CatalogActionState, formData: FormData): Promise<CatalogActionState> {
  const member = await requireSession();
  const scope = await targetScope(member, String(formData.get("organizationId") ?? ""));
  if (!scope) return invalid("Этот каталог недоступен.");
  const parsed = catalogItemSchema.safeParse({ id: formData.get("id") || undefined, expectedVersion: formData.get("expectedVersion") || undefined, kind: formData.get("kind"), name: formData.get("name"), description: formData.get("description") ?? "", sku: formData.get("sku") ?? "", unit: formData.get("unit"), priceMode: formData.get("priceMode"), defaultPrice: formData.get("defaultPrice") ?? "" });
  if (!parsed.success) return { status: "error", message: "Проверьте поля позиции.", fieldErrors: Object.fromEntries(Object.entries(parsed.error.flatten().fieldErrors).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]))) };
  try {
    await saveCatalogItem(scope, parsed.data);
    revalidatePath("/catalog"); revalidatePath("/services"); revalidatePath("/quick-order");
    return { status: "success", message: "Позиция сохранена.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof CatalogConflictError) return invalid("Название или артикул уже заняты, либо позицию изменили. Обновите страницу.");
    console.error("catalog.save", error);
    return invalid("Не удалось сохранить позицию.");
  }
}

export async function setCatalogItemActiveAction(organizationId: string, id: string, expectedVersion: number, active: boolean): Promise<CatalogActionState> {
  const member = await requireSession();
  const scope = await targetScope(member, organizationId);
  if (!scope) return invalid("Этот каталог недоступен.");
  const parsed = catalogArchiveSchema.safeParse({ id, expectedVersion, active });
  if (!parsed.success) return invalid("Недопустимая позиция.");
  try {
    await setCatalogItemActive(scope, parsed.data.id, parsed.data.expectedVersion, parsed.data.active);
    revalidatePath("/catalog"); revalidatePath("/services"); revalidatePath("/quick-order");
    return { status: "success", message: active ? "Позиция восстановлена." : "Позиция скрыта из выбора.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof CatalogConflictError) return invalid("Позицию уже изменили. Обновите страницу.");
    console.error("catalog.archive", error);
    return invalid("Не удалось изменить позицию.");
  }
}

export async function deleteCatalogItemAction(organizationId: string, id: string, expectedVersion: number): Promise<CatalogActionState> {
  const member = await requireSession();
  const scope = await targetScope(member, organizationId);
  if (!scope || !z.string().uuid().safeParse(id).success || !z.number().int().positive().safeParse(expectedVersion).success) return invalid("Позиция недоступна.");
  try {
    const result = await deleteCatalogItem(scope, id, expectedVersion);
    revalidatePath("/services"); revalidatePath("/quick-order");
    return { status: "success", message: result === "deleted" ? "Позиция удалена." : "Позиция использовалась в заказах и скрыта в архив.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof CatalogConflictError) return invalid("Позицию уже изменили. Обновите страницу.");
    console.error("catalog.delete", error);
    return invalid("Не удалось удалить позицию.");
  }
}

export async function saveCatalogUnitAction(organizationId: string, input: { id?: string; expectedVersion?: number; symbol: string; label: string }): Promise<CatalogActionState> {
  const member = await requireSession();
  const scope = await targetScope(member, organizationId);
  if (!scope) return invalid("Каталог недоступен.");
  const parsed = z.object({ id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(), symbol: z.string().trim().min(1).max(40), label: z.string().trim().min(1).max(100) }).safeParse(input);
  if (!parsed.success || Boolean(parsed.data?.id) !== Boolean(parsed.data?.expectedVersion)) return invalid("Укажите обозначение и название единицы.");
  try {
    await saveCatalogUnit(scope, parsed.data);
    revalidatePath("/services"); revalidatePath("/quick-order");
    return { status: "success", message: "Единица сохранена.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof CatalogConflictError) return invalid("Такая единица уже есть или список изменился. Обновите страницу.");
    console.error("catalog.unit.save", error);
    return invalid("Не удалось сохранить единицу.");
  }
}

export async function deleteCatalogUnitAction(organizationId: string, id: string, expectedVersion: number): Promise<CatalogActionState> {
  const member = await requireSession();
  const scope = await targetScope(member, organizationId);
  if (!scope || !z.string().uuid().safeParse(id).success || !z.number().int().positive().safeParse(expectedVersion).success) return invalid("Единица недоступна.");
  try {
    await deleteCatalogUnit(scope, id, expectedVersion);
    revalidatePath("/services");
    return { status: "success", message: "Единица удалена из списка.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof CatalogConflictError) return invalid("Единица используется в каталоге. Сначала измените эти позиции.");
    console.error("catalog.unit.delete", error);
    return invalid("Не удалось удалить единицу.");
  }
}
