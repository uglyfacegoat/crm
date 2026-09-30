"use server";

import { safeErrorCode } from "@/server/observability/safe-error";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getAuthMode } from "@/server/auth/config";
import { endSession } from "@/server/auth/service";
import {
  clearSessionCookie,
  requireOfficeSession,
  SESSION_COOKIE_NAME,
} from "@/server/auth/session";
import {
  OrganizationAccessError,
  switchActiveOrganization,
} from "@/server/organizations/repository";
import { AuthorizationError } from "@/server/auth/permissions";
import { switchOrganizationSchema } from "@/server/organizations/schemas";

export type OrganizationSwitchState = {
  status: "idle" | "error";
  message: string | null;
};

export async function logoutAction() {
  if (getAuthMode() === "required") {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) await endSession(token);
    await clearSessionCookie();
  }
  redirect("/login");
}

export async function switchOrganizationAction(
  _previous: OrganizationSwitchState,
  formData: FormData,
): Promise<OrganizationSwitchState> {
  const member = await requireOfficeSession();
  if (getAuthMode() !== "required")
    return {
      status: "error",
      message: "В режиме предпросмотра переключение компаний недоступно.",
    };
  const parsed = switchOrganizationSchema.safeParse({
    organizationId: formData.get("organizationId"),
  });
  if (!parsed.success)
    return {
      status: "error",
      message: "Не удалось определить выбранную компанию.",
    };
  try {
    await switchActiveOrganization(member, parsed.data.organizationId);
  } catch (error) {
    if (error instanceof AuthorizationError)
      return {
        status: "error",
        message: "Недостаточно прав для переключения компании.",
      };
    if (error instanceof OrganizationAccessError)
      return {
        status: "error",
        message: "Эта компания недоступна для вашей учётной записи.",
      };
    console.error(
      JSON.stringify({
        operation: "organization.switch",
        actorId: member.memberId,
        errorCode: safeErrorCode(error),
      }),
    );
    return {
      status: "error",
      message: "Не удалось переключить компанию. Попробуйте ещё раз.",
    };
  }
  revalidatePath("/", "layout");
  redirect("/");
}
