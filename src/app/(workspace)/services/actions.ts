"use server";

import { revalidatePath } from "next/cache";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listCenterCompanyScopes } from "@/server/organizations/center-dashboard";
import { ObjectServiceConflictError, ObjectServiceReferenceError, saveObjectServiceProfile } from "@/server/catalog/object-service-profiles";
import { objectServiceProfileSchema, type ObjectServiceProfileInput } from "@/server/catalog/profile-schemas";

export async function saveObjectServiceProfileAction(input: ObjectServiceProfileInput) {
  const member = await requireOfficeSession();
  const parsed = objectServiceProfileSchema.safeParse(input);
  if (!parsed.success) return { status: "error" as const, message: parsed.error.issues[0]?.message ?? "Проверьте поля." };
  const scope = input.organizationId === member.organizationId ? member
    : hasPermission(member, "companies.read")
      ? (await listCenterCompanyScopes(member)).find((item) => item.organizationId === input.organizationId)
      : null;
  if (!scope || !hasPermission(scope, "orders.write")) return { status: "error" as const, message: "Нет доступа к этому объекту." };
  try {
    await saveObjectServiceProfile(scope, parsed.data);
    revalidatePath("/services");
    revalidatePath("/quick-order");
    revalidatePath("/orders");
    return { status: "success" as const, message: "Условия объекта сохранены." };
  } catch (error) {
    if (error instanceof ObjectServiceConflictError) return { status: "error" as const, message: "Карточку изменили. Обновите страницу и повторите." };
    if (error instanceof ObjectServiceReferenceError) return { status: "error" as const, message: "Объект или услуга недоступны." };
    console.error("services.profile.save", error);
    return { status: "error" as const, message: "Не удалось сохранить условия объекта." };
  }
}
