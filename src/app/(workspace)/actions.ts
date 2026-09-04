"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { endSession } from "@/server/auth/service";
import { clearSessionCookie, requireSession, SESSION_COOKIE_NAME } from "@/server/auth/session";
import { switchActiveOrganization } from "@/server/organizations/repository";
import { switchOrganizationSchema } from "@/server/organizations/schemas";

export async function logoutAction() {
  if (getAuthMode() === "required") {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) await endSession(token);
    await clearSessionCookie();
  }
  redirect("/login");
}

export async function switchOrganizationAction(formData: FormData) {
  if (getAuthMode() !== "required") return;
  const member = await requireSession();
  const parsed = switchOrganizationSchema.safeParse({ organizationId: formData.get("organizationId") });
  if (!parsed.success) return;
  await switchActiveOrganization(member, parsed.data.organizationId);
  revalidatePath("/", "layout");
}
