import { isAbsolute, resolve } from "node:path";
import { parseS3Config, storageBackend } from "../src/server/storage/s3-config.mjs";
import { parseBackupWorkerConfig } from "./backup-worker-config.mjs";
import { parseReminderWorkerInterval } from "./reminder-worker-config.mjs";

function databaseUrl(environment) {
  let url;
  try { url = new URL(environment.DATABASE_URL); }
  catch { throw new Error("Invalid DATABASE_URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) {
    throw new Error("Invalid DATABASE_URL.");
  }
  return environment.DATABASE_URL;
}

function absolutePath(value, name) {
  if (!value || !isAbsolute(value)) throw new Error(`Invalid ${name}.`);
  return resolve(value);
}

export function validateReminderWorkerEnvironment(environment) {
  return {
    databaseUrl: databaseUrl(environment),
    intervalMs: parseReminderWorkerInterval(environment.REMINDER_WORKER_INTERVAL_MS),
  };
}

export function validateBackupWorkerEnvironment(environment) {
  const validatedDatabaseUrl = databaseUrl(environment);
  const config = parseBackupWorkerConfig(environment);
  const backend = storageBackend(environment);
  if (backend === "s3") parseS3Config(environment);
  const storageRoot = absolutePath(environment.DOCUMENT_STORAGE_ROOT ?? "/app/storage", "DOCUMENT_STORAGE_ROOT");
  const backupRoot = absolutePath(environment.BACKUP_ROOT ?? "/app/backups", "BACKUP_ROOT");
  const backupExportRoot = environment.BACKUP_EXPORT_ROOT === undefined ? null
    : absolutePath(environment.BACKUP_EXPORT_ROOT, "BACKUP_EXPORT_ROOT");
  return { databaseUrl: validatedDatabaseUrl, config, backend, storageRoot, backupRoot, backupExportRoot };
}
