"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthMode } from "@/server/auth/config";
import { endSession } from "@/server/auth/service";
import { clearSessionCookie, SESSION_COOKIE_NAME } from "@/server/auth/session";

export async function logoutAction() {
  if (getAuthMode() === "required") {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (token) await endSession(token);
    await clearSessionCookie();
  }
  redirect("/login");
}
