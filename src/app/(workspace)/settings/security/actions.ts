"use server";

import { revalidatePath } from "next/cache";
import { getAuthMode, getThrottleSecret } from "@/server/auth/config";
import { consumeRateLimit } from "@/server/auth/repository";
import { requireSession } from "@/server/auth/session";
import { createPrivateBucketHash } from "@/server/auth/token";
import { beginOwnEmailOtpEnrollment, changeOwnPassword, confirmOwnEmailOtpEnrollment, disableOwnEmailOtp } from "@/server/auth/security-settings";
import { safeErrorCode } from "@/server/observability/safe-error";

export type SecurityActionState = { status: "idle" | "success" | "error"; message: string };

const unavailable: SecurityActionState = { status: "error", message: "В демонстрационном режиме изменение безопасности недоступно." };
function result(status: SecurityActionState["status"], message: string): SecurityActionState { return { status, message }; }
function logError(operation: string, error: unknown) {
  console.error(JSON.stringify({ operation, errorCode: safeErrorCode(error) }));
}
async function allowed(memberId: string, operation: string, limit: number, minutes: number) {
  return consumeRateLimit([createPrivateBucketHash(getThrottleSecret(), `security:${operation}:${memberId}`)], limit, minutes);
}

export async function changePasswordAction(_previous: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  if (getAuthMode() === "preview") return unavailable;
  const member = await requireSession();
  if (!(await allowed(member.memberId, "password", 8, 15))) return result("error", "Слишком много попыток. Повторите позже.");
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (current.length < 8 || current.length > 128 || next.length < 12 || next.length > 128 || next !== confirmation)
    return result("error", "Проверьте текущий пароль и новый пароль (от 12 символов); подтверждение должно совпадать.");
  try {
    if (!(await changeOwnPassword(member, current, next))) return result("error", "Текущий пароль неверный или новый совпадает с ним.");
    return result("success", "Пароль обновлён. Другие активные сеансы завершены.");
  } catch (error) { logError("security.password_change", error); return result("error", "Не удалось обновить пароль. Попробуйте позже."); }
}

export async function beginEmailOtpAction(): Promise<SecurityActionState> {
  if (getAuthMode() === "preview") return unavailable;
  const member = await requireSession();
  if (!(await allowed(member.memberId, "enroll", 3, 60))) return result("error", "Слишком много запросов кода. Повторите через час.");
  try {
    const state = await beginOwnEmailOtpEnrollment(member);
    if (state === "mail_unavailable") return result("error", "Отправка почты пока не настроена. Подключить защиту сейчас нельзя.");
    if (state === "already_enabled") return result("error", "Защита по почте уже включена.");
    revalidatePath("/settings");
    return result("success", "Код отправляется на почту вашей учётной записи. Введите его ниже в течение 10 минут.");
  } catch (error) { logError("security.email_otp_begin", error); return result("error", "Не удалось отправить код. Попробуйте позже."); }
}

export async function confirmEmailOtpAction(_previous: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  if (getAuthMode() === "preview") return unavailable;
  const member = await requireSession();
  if (!(await allowed(member.memberId, "confirm", 8, 15))) return result("error", "Слишком много попыток. Повторите позже.");
  try {
    if (!(await confirmOwnEmailOtpEnrollment(member, String(formData.get("code") ?? "").trim())))
      return result("error", "Код неверный, ещё не доставлен или уже истёк.");
    revalidatePath("/settings");
    return result("success", "Защита входа по почте подключена. При следующем входе потребуется код.");
  } catch (error) { logError("security.email_otp_confirm", error); return result("error", "Не удалось проверить код. Попробуйте позже."); }
}

export async function disableEmailOtpAction(_previous: SecurityActionState, formData: FormData): Promise<SecurityActionState> {
  if (getAuthMode() === "preview") return unavailable;
  const member = await requireSession();
  if (!(await allowed(member.memberId, "disable", 8, 15))) return result("error", "Слишком много попыток. Повторите позже.");
  try {
    if (!(await disableOwnEmailOtp(member, String(formData.get("password") ?? ""))))
      return result("error", "Пароль неверный или защита уже отключена.");
    revalidatePath("/settings");
    return result("success", "Подтверждение входа по почте отключено.");
  } catch (error) { logError("security.email_otp_disable", error); return result("error", "Не удалось отключить защиту. Попробуйте позже."); }
}
