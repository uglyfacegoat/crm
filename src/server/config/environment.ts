import { isAbsolute } from "node:path";
import { z } from "zod";
import { parseS3Config, storageBackend } from "../storage/s3-config.mjs";
import { fileScanConfig } from "../file-scan/clamd.mjs";

export const authModeSchema = z.enum(["preview", "required"]);
export const booleanEnvironmentSchema = z.enum(["true", "false"]);
export const allowedOriginsSchema = z.string().min(1).transform((value) => value.split(",").map((origin) => origin.trim())).pipe(
  z.array(z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" && !url.hostname.includes("*");
    } catch {
      return false;
    }
  })).min(1),
).transform((origins) => [...new Set(origins.map((origin) => new URL(origin).origin))]);
export const databaseUrlSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
});
export const storageRootSchema = z.string().min(1).refine(isAbsolute);
export const secretSchema = z.string().min(32).refine(
  (value) => value === value.trim() && !/^replace-with|^change-?me/i.test(value),
);

type Environment = Readonly<Record<string, string | undefined>>;

export function validateRuntimeEnvironment(environment: Environment) {
  const invalidFields: string[] = [];
  const mode = environment.AUTH_MODE ?? (environment.NODE_ENV === "production" ? undefined : "preview");
  if (!authModeSchema.safeParse(mode).success) invalidFields.push("AUTH_MODE");
  if (environment.AUTH_COOKIE_SECURE !== undefined && !booleanEnvironmentSchema.safeParse(environment.AUTH_COOKIE_SECURE).success) {
    invalidFields.push("AUTH_COOKIE_SECURE");
  }
  if (environment.CRM_TRUST_PROXY !== undefined && !booleanEnvironmentSchema.safeParse(environment.CRM_TRUST_PROXY).success) invalidFields.push("CRM_TRUST_PROXY");
  if ((mode === "required" && environment.NODE_ENV === "production") || environment.CRM_ALLOWED_ORIGINS !== undefined) {
    if (!allowedOriginsSchema.safeParse(environment.CRM_ALLOWED_ORIGINS).success) invalidFields.push("CRM_ALLOWED_ORIGINS");
  }
  if (mode === "required" && environment.NODE_ENV === "production" && environment.CRM_TRUST_PROXY === "true") {
    const origins = allowedOriginsSchema.safeParse(environment.CRM_ALLOWED_ORIGINS);
    if (origins.success && origins.data.some((origin) => !origin.startsWith("https://"))) invalidFields.push("CRM_ALLOWED_ORIGINS");
    if (environment.AUTH_COOKIE_SECURE === "false") invalidFields.push("AUTH_COOKIE_SECURE");
  }
  if ((mode === "required" || environment.DATABASE_URL !== undefined) && !databaseUrlSchema.safeParse(environment.DATABASE_URL).success) {
    invalidFields.push("DATABASE_URL");
  }
  if ((mode === "required" || environment.AUTH_THROTTLE_SECRET !== undefined) && !secretSchema.safeParse(environment.AUTH_THROTTLE_SECRET).success) {
    invalidFields.push("AUTH_THROTTLE_SECRET");
  }
  let backend;
  try { backend = storageBackend(environment); }
  catch { invalidFields.push("DOCUMENT_STORAGE_BACKEND"); }
  if (backend === "s3") {
    try { parseS3Config(environment); }
    catch (error) { invalidFields.push(error instanceof Error ? error.message : "DOCUMENT_S3 configuration"); }
  }
  if ((backend === "local" && mode === "required" && environment.NODE_ENV === "production") || environment.DOCUMENT_STORAGE_ROOT !== undefined) {
    if (!storageRootSchema.safeParse(environment.DOCUMENT_STORAGE_ROOT).success) invalidFields.push("DOCUMENT_STORAGE_ROOT");
  }
  try { fileScanConfig(environment); }
  catch { invalidFields.push("CRM_FILE_SCAN_MODE/CRM_CLAMD configuration"); }
  // An empty webhook secret intentionally disables public website intake.
  if (environment.CRM_WEBSITE_WEBHOOK_SECRET && !secretSchema.safeParse(environment.CRM_WEBSITE_WEBHOOK_SECRET).success) {
    invalidFields.push("CRM_WEBSITE_WEBHOOK_SECRET");
  }
  if (invalidFields.length) {
    // Do not attach Zod errors or input values: connection strings contain credentials.
    throw new Error(`Invalid runtime configuration: ${invalidFields.join(", ")}. Check required values and deployment configuration.`);
  }
}
