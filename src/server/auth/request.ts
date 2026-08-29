import "server-only";

export function getClientAddress(headers: Headers) {
  const forwardedAddress = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedAddress || headers.get("x-real-ip")?.trim() || null;
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}
