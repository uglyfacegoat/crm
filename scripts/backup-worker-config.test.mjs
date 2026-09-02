import assert from "node:assert/strict";
import test from "node:test";
import {
  backupWorkerHealthWindow,
  databaseProcessEnvironment,
  parseBackupWorkerConfig,
} from "./backup-worker-config.mjs";

test("backup worker uses safe production defaults", () => {
  assert.deepEqual(parseBackupWorkerConfig({}), {
    backupIntervalMs: 86_400_000,
    pollIntervalMs: 60_000,
    retryIntervalMs: 900_000,
    retentionDays: 30,
  });
});

test("backup worker validates scheduling and retention bounds", () => {
  assert.equal(parseBackupWorkerConfig({ BACKUP_RETENTION_DAYS: "365" }).retentionDays, 365);
  assert.throws(() => parseBackupWorkerConfig({ BACKUP_INTERVAL_MS: "1000" }));
  assert.throws(() => parseBackupWorkerConfig({ BACKUP_WORKER_POLL_MS: "1.5" }));
  assert.throws(() => parseBackupWorkerConfig({ BACKUP_RETENTION_DAYS: "0" }));
});

test("backup health window allows missed polls", () => {
  assert.equal(backupWorkerHealthWindow(5_000), 300_000);
  assert.equal(backupWorkerHealthWindow(120_000), 360_000);
});

test("database process environment keeps credentials out of command arguments", () => {
  const result = databaseProcessEnvironment("postgresql://crm%20user:p%40ss@database:5433/crm_main?sslmode=disable", {});
  assert.equal(result.databaseName, "crm_main");
  assert.deepEqual(result.processEnvironment, {
    PGHOST: "database",
    PGPORT: "5433",
    PGUSER: "crm user",
    PGDATABASE: "crm_main",
    PGPASSWORD: "p@ss",
    PGSSLMODE: "disable",
  });
});

test("database process environment rejects incomplete and unrelated URLs", () => {
  assert.throws(() => databaseProcessEnvironment("https://database/crm", {}));
  assert.throws(() => databaseProcessEnvironment("postgresql://database", {}));
});
