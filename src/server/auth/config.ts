import "server-only";
import { z } from "zod";
import { authModeSchema, booleanEnvironmentSchema, secretSchema } from "@/server/config/environment";

export type AuthMode = z.infer<typeof authModeSchema>;

export function getAuthMode(): AuthMode {
  const configuredMode = process.env.AUTH_MODE;
  if (configuredMode) return authModeSchema.parse(configuredMode);
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_MODE is required in production.");
  return "preview";
}

export function getThrottleSecret() {
  return secretSchema.parse(process.env.AUTH_THROTTLE_SECRET);
}

export function shouldUseSecureSessionCookie() {
  const configuredValue = process.env.AUTH_COOKIE_SECURE;
  if (configuredValue) return booleanEnvironmentSchema.parse(configuredValue) === "true";
  return process.env.NODE_ENV === "production";
}
