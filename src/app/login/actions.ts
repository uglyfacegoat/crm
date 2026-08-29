"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthMode } from "@/server/auth/config";
import { getClientAddress } from "@/server/auth/request";
import { authenticateMember } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";

export type LoginState = { error: string | null };

function safeNextPath(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function loginAction(_previousState: LoginState, formData: FormData): Promise<LoginState> {
  const nextPath = safeNextPath(formData.get("next"));
  if (getAuthMode() === "preview") redirect(nextPath);

  const requestHeaders = await headers();
  let result;
  try {
    result = await authenticateMember({
      identity: String(formData.get("identity") ?? ""),
      password: String(formData.get("password") ?? ""),
      remember: formData.get("remember") === "on",
      clientAddress: getClientAddress(requestHeaders),
    });
  } catch (error) {
    console.error(JSON.stringify({ operation: "auth.login", category: "unexpected", error: error instanceof Error ? error.message : "Unknown error" }));
    return { error: "Сервис входа временно недоступен. Попробуйте ещё раз позднее." };
  }

  if (!result.ok) {
    return { error: result.reason === "rate_limited" ? "Слишком много попыток. Повторите вход через 15 минут." : "Неверный логин или пароль." };
  }
  await setSessionCookie(result.session);
  redirect(nextPath);
}
