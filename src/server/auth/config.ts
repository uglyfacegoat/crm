import "server-only";
import { z } from "zod";

const authModeSchema = z.enum(["preview", "required"]);
const throttleSecretSchema = z.string().min(32, "AUTH_THROTTLE_SECRET must contain at least 32 characters");
const booleanEnvironmentSchema = z.enum(["true", "false"]);

export type AuthMode = z.infer<typeof authModeSchema>;

export function getAuthMode(): AuthMode {
  const configuredMode = process.env.AUTH_MODE;
  if (configuredMode) return authModeSchema.parse(configuredMode);
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_MODE is required in production.");
  return "preview";
}

export function getThrottleSecret() {
  return throttleSecretSchema.parse(process.env.AUTH_THROTTLE_SECRET);
}

export function shouldUseSecureSessionCookie() {
  const configuredValue = process.env.AUTH_COOKIE_SECURE;
  if (configuredValue) return booleanEnvironmentSchema.parse(configuredValue) === "true";
  return process.env.NODE_ENV === "production";
}
