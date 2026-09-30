import "server-only";
import { matchesRequestOrigin } from "./same-origin";
import { getTrustedClientAddress } from "./client-address";
import { allowedOriginsSchema } from "@/server/config/environment";

export function getClientAddress(headers: Headers) {
  return getTrustedClientAddress(headers, process.env.CRM_TRUST_PROXY === "true");
}

export function getAllowedRequestOrigins(request: Request) {
  if (process.env.CRM_ALLOWED_ORIGINS !== undefined) return allowedOriginsSchema.parse(process.env.CRM_ALLOWED_ORIGINS);
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "required") throw new Error("CRM_ALLOWED_ORIGINS is required.");
  const url = new URL(request.url);
  return [`${url.protocol}//${request.headers.get("host") ?? url.host}`];
}

export function isSameOriginRequest(request: Request) {
  return matchesRequestOrigin(request.headers.get("origin"), getAllowedRequestOrigins(request));
}
