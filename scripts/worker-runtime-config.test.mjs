import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateBackupWorkerEnvironment, validateReminderWorkerEnvironment } from "./worker-runtime-config.mjs";

const validDatabaseUrl = "postgresql://crm:do-not-log-this@127.0.0.1:1/crm";

test("worker configuration validates database, schedule, storage and backup paths", () => {
  assert.equal(validateReminderWorkerEnvironment({ DATABASE_URL: validDatabaseUrl }).intervalMs, 60_000);
  assert.equal(validateBackupWorkerEnvironment({ DATABASE_URL: validDatabaseUrl }).backend, "local");
  for (const databaseUrl of [undefined, "", "https://example.test/crm", "postgresql://database", "postgresql://database/crm"]) {
    assert.throws(() => validateReminderWorkerEnvironment({ DATABASE_URL: databaseUrl }), /DATABASE_URL/);
    assert.throws(() => validateBackupWorkerEnvironment({ DATABASE_URL: databaseUrl }), /DATABASE_URL/);
  }
  assert.throws(() => validateBackupWorkerEnvironment({ DATABASE_URL: validDatabaseUrl, DOCUMENT_STORAGE_BACKEND: "s3" }), /DOCUMENT_S3_ENDPOINT/);
  assert.throws(() => validateBackupWorkerEnvironment({ DATABASE_URL: validDatabaseUrl, BACKUP_ROOT: "relative" }), /BACKUP_ROOT/);
  assert.throws(() => validateBackupWorkerEnvironment({ DATABASE_URL: validDatabaseUrl, BACKUP_EXPORT_ROOT: "" }), /BACKUP_EXPORT_ROOT/);
});

for (const [script, invalidEnvironment, expectedField] of [
  ["scripts/reminder-worker.mjs", { DATABASE_URL: undefined }, "DATABASE_URL"],
  ["scripts/reminder-worker.mjs", { REMINDER_WORKER_INTERVAL_MS: "1" }, "REMINDER_WORKER_INTERVAL_MS"],
  ["scripts/backup-worker.mjs", { DATABASE_URL: undefined }, "DATABASE_URL"],
  ["scripts/backup-worker.mjs", { DOCUMENT_STORAGE_BACKEND: "s3" }, "DOCUMENT_S3_ENDPOINT"],
  ["scripts/backup-worker.mjs", { BACKUP_ROOT: "relative" }, "BACKUP_ROOT"],
]) {
  test(`${script} rejects invalid ${expectedField} before connecting`, () => {
    const result = spawnSync(process.execPath, [script, "--healthcheck"], {
      env: { NODE_ENV: "production", DATABASE_URL: validDatabaseUrl, ...invalidEnvironment },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(expectedField));
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-log-this/);
  });
}
