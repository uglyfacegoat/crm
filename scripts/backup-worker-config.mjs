const DEFAULT_BACKUP_INTERVAL_MS = 86_400_000;
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_RETRY_INTERVAL_MS = 900_000;
const DEFAULT_RETENTION_DAYS = 30;

function parseBoundedInteger(rawValue, name, defaultValue, minimum, maximum) {
  if (rawValue === undefined || rawValue === "") return defaultValue;
  if (!/^\d+$/.test(rawValue)) throw new Error(`${name} must be an integer.`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function parseBackupWorkerConfig(environment) {
  return {
    backupIntervalMs: parseBoundedInteger(
      environment.BACKUP_INTERVAL_MS,
      "BACKUP_INTERVAL_MS",
      DEFAULT_BACKUP_INTERVAL_MS,
      3_600_000,
      604_800_000,
    ),
    pollIntervalMs: parseBoundedInteger(
      environment.BACKUP_WORKER_POLL_MS,
      "BACKUP_WORKER_POLL_MS",
      DEFAULT_POLL_INTERVAL_MS,
      5_000,
      300_000,
    ),
    retryIntervalMs: parseBoundedInteger(
      environment.BACKUP_RETRY_INTERVAL_MS,
      "BACKUP_RETRY_INTERVAL_MS",
      DEFAULT_RETRY_INTERVAL_MS,
      60_000,
      86_400_000,
    ),
    retentionDays: parseBoundedInteger(
      environment.BACKUP_RETENTION_DAYS,
      "BACKUP_RETENTION_DAYS",
      DEFAULT_RETENTION_DAYS,
      1,
      365,
    ),
  };
}

export function backupWorkerHealthWindow(pollIntervalMs) {
  return Math.max(pollIntervalMs * 3, 300_000);
}

export function databaseProcessEnvironment(databaseUrl, baseEnvironment = process.env) {
  const parsedUrl = new URL(databaseUrl);
  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use the postgresql protocol.");
  }
  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
  if (!parsedUrl.hostname || !parsedUrl.username || !databaseName || databaseName.includes("/")) {
    throw new Error("DATABASE_URL must contain a host, user, and database name.");
  }

  const processEnvironment = {
    ...baseEnvironment,
    PGHOST: parsedUrl.hostname,
    PGPORT: parsedUrl.port || "5432",
    PGUSER: decodeURIComponent(parsedUrl.username),
    PGDATABASE: databaseName,
  };
  if (parsedUrl.password) processEnvironment.PGPASSWORD = decodeURIComponent(parsedUrl.password);
  const sslMode = parsedUrl.searchParams.get("sslmode");
  if (sslMode) processEnvironment.PGSSLMODE = sslMode;

  return { databaseName, processEnvironment };
}
