import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "crm_session";

export function proxy(request: NextRequest) {
  const authMode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === "production" ? null : "preview");
  if (!authMode) throw new Error("AUTH_MODE is required in production.");
  if (authMode === "preview") return NextResponse.next();
  if (authMode !== "required") throw new Error("AUTH_MODE must be either preview or required.");
  if (request.cookies.has(SESSION_COOKIE_NAME)) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!api|login|_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|crm-app-icon\\.svg$|help/[^/]+\\.png$).*)",
  ],
};
