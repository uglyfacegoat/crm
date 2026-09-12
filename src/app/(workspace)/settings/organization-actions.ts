"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { AuthorizationError } from "@/server/auth/permissions";
import { requireSession } from "@/server/auth/session";
import { createOrganization, OrganizationAccessError, OrganizationNameConflictError } from "@/server/organizations/repository";
import { createOrganizationSchema } from "@/server/organizations/schemas";

export type OrganizationMutationState = { status: "idle" | "success" | "error"; message: string | null; fieldErrors: Record<string, string[]> };

export async function createOrganizationAction(_previous: OrganizationMutationState, formData: FormData): Promise<OrganizationMutationState> {
  if (getAuthMode() === "preview") return { status: "error", message: "Предпросмотр не создаёт компании.", fieldErrors: {} };
  const member = await requireSession();
  const parsed = createOrganizationSchema.safeParse({
    idempotencyKey: formData.get("idempotencyKey"),
    name: formData.get("name"),
    timezone: formData.get("timezone"),
  });
  if (!parsed.success) return { status: "error", message: "Проверьте данные компании.", fieldErrors: parsed.error.flatten().fieldErrors };
  try {
    await createOrganization(member, parsed.data);
    revalidatePath("/", "layout");
    revalidatePath("/settings");
    return { status: "success", message: "Компания создана и доступна в переключателе.", fieldErrors: {} };
  } catch (error) {
    if (error instanceof AuthorizationError) return { status: "error", message: "Недостаточно прав для создания компании.", fieldErrors: {} };
    if (error instanceof OrganizationNameConflictError) return { status: "error", message: "Компания с таким названием уже есть в центре.", fieldErrors: { name: ["Введите другое название"] } };
    if (error instanceof OrganizationAccessError) return { status: "error", message: "Создавать компании можно только из Центра компаний.", fieldErrors: {} };
    console.error(JSON.stringify({ operation: "organization.create", actorId: member.memberId, error: error instanceof Error ? error.message : "Unknown error" }));
    return { status: "error", message: "Не удалось создать компанию.", fieldErrors: {} };
  }
}
