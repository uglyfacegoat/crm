"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeErrorCode } from "@/server/observability/safe-error";
import { getClientAddress } from "@/server/auth/request";
import { safeLoginRedirect } from "@/server/auth/login-redirect";
import { EMAIL_CHALLENGE_COOKIE_NAME } from "@/server/auth/email-otp-repository";
import { verifyMemberEmailCode } from "@/server/auth/service";
import { clearEmailChallengeCookie, setSessionCookie } from "@/server/auth/session";

export type VerifyEmailCodeState = { error: string | null };

export async function verifyEmailCodeAction(_previous: VerifyEmailCodeState, formData: FormData): Promise<VerifyEmailCodeState> {
  const token = (await cookies()).get(EMAIL_CHALLENGE_COOKIE_NAME)?.value;
  if (!token) return { error: "Срок подтверждения истёк. Войдите ещё раз." };
  let session;
  try {
    session = await verifyMemberEmailCode({ token, code: String(formData.get("code") ?? "").trim(),
      clientAddress: getClientAddress(await headers()) });
  } catch (error) {
    console.error(JSON.stringify({ operation: "auth.email_otp", category: "unexpected", errorCode: safeErrorCode(error) }));
    return { error: "Подтверждение временно недоступно. Попробуйте позже." };
  }
  if (!session) return { error: "Неверный или просроченный код. Проверьте письмо либо войдите заново." };
  await setSessionCookie(session);
  await clearEmailChallengeCookie();
  redirect(safeLoginRedirect(formData.get("next")));
}
