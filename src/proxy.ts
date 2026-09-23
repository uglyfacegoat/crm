import { NextRequest, NextResponse } from "next/server";
import { getAllowedRequestOrigins } from "@/server/auth/request";
import { matchesRequestOrigin } from "@/server/auth/same-origin";

const SESSION_COOKIE_NAME = "crm_session";

export function proxy(request: NextRequest) {
  const allowedOrigins = getAllowedRequestOrigins(request);
  const path = request.nextUrl.pathname;
  const host = request.headers.get("host");
  if (!["/api/v1/system/health", "/api/v1/system/live", "/api/v1/system/ready"].includes(path)
    && !allowedOrigins.some((origin) => new URL(origin).host === host)) {
    return NextResponse.json({ error: { code: "invalid_host", message: "Недопустимый адрес сервера." } }, { status: 421 });
  }
  const safeMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
  const bearerWebhook = path === "/api/v1/webhooks/website-leads";
  if (!safeMethod && !bearerWebhook && !matchesRequestOrigin(request.headers.get("origin"), allowedOrigins)) {
    return NextResponse.json({ error: { code: "invalid_origin", message: "Недопустимый источник запроса." } }, { status: 403 });
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-forwarded-host", host ?? "");
  if (process.env.CRM_TRUST_PROXY !== "true") {
    for (const name of ["forwarded", "x-real-ip", "x-forwarded-for", "x-forwarded-proto"]) requestHeaders.delete(name);
  }
  const isPage = !path.startsWith("/api/");
  let contentSecurityPolicy: string | undefined;
  if (isPage) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    contentSecurityPolicy = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      // React/Recharts position elements with inline styles; scripts still require a nonce.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' blob:",
      `connect-src 'self'${process.env.NODE_ENV === "development" ? " ws: wss:" : ""}`,
      "frame-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; ");
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  }
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (contentSecurityPolicy) response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  const authMode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === "production" ? null : "preview");
  if (!authMode) throw new Error("AUTH_MODE is required in production.");
  if (authMode === "preview") return response;
  if (authMode !== "required") throw new Error("AUTH_MODE must be either preview or required.");
  if (!isPage || path === "/login" || request.cookies.has(SESSION_COOKIE_NAME)) return response;

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest$|crm-app-icon\\.svg$|help/[^/]+\\.png$).*)",
  ],
};
