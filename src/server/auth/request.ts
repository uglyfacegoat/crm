import "server-only";
import { matchesRequestOrigin } from "./same-origin";

export function getClientAddress(headers: Headers) {
  const forwardedAddress = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedAddress || headers.get("x-real-ip")?.trim() || null;
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return matchesRequestOrigin({
    origin,
    requestUrl: request.url,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProtocol: request.headers.get("x-forwarded-proto"),
  });
}
