import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuthMode, shouldUseSecureSessionCookie } from "./config";
import { resolveSession } from "./service";
import type { AuthenticatedMember, SessionCookie } from "./types";

export const SESSION_COOKIE_NAME = "crm_session";

const previewMember: AuthenticatedMember = {
  sessionId: "00000000-0000-0000-0000-000000000000",
  organizationId: "00000000-0000-0000-0000-000000000000",
  organizationName: "Демонстрационная компания",
  memberId: "00000000-0000-0000-0000-000000000000",
  displayName: "Иван Петров",
  email: "preview@crm.local",
  role: "admin",
  masterId: null,
  permissionOverrides: {},
};

export async function requireOfficeSession() {
  const session = await requireSession();
  if (session.role === "master") redirect("/my-visits");
  return session;
}

export async function setSessionCookie(session: SessionCookie) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(),
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", { httpOnly: true, secure: shouldUseSecureSessionCookie(), sameSite: "lax", path: "/", maxAge: 0 });
}

export const getCurrentSession = cache(async () => {
  if (getAuthMode() === "preview") return previewMember;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return token ? resolveSession(token) : null;
});

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session;
}
