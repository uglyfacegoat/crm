import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { safeErrorCode } from "../src/server/observability/safe-error.ts";
import { safeCliErrorCode } from "./safe-cli-error.mjs";

test("safe error codes never serialize exception messages or arbitrary code values", () => {
  const secret = new Error("postgresql://admin:private-password@db.example/crm");
  secret.code = "private-password";
  assert.equal(safeErrorCode(secret), "UNEXPECTED");
  secret.code = "ECONNREFUSED";
  assert.equal(safeErrorCode(secret), "ECONNREFUSED");
  assert.equal(safeErrorCode("private-password"), "NON_ERROR_THROWN");
  assert.equal(safeErrorCode({ get code() { throw new Error("private-password"); } }), "UNEXPECTED");
});


test("CLI and worker error categories cannot contain provider secrets", () => {
  const secret = new Error("s3://secret-key@storage.example/private");
  secret.code = "secret-key";
  secret.name = "AuthError secret-key";
  assert.equal(safeCliErrorCode(secret, "BACKUP_FAILED"), "BACKUP_FAILED");
  secret.code = "ETIMEDOUT";
  assert.equal(safeCliErrorCode(secret, "BACKUP_FAILED"), "ETIMEDOUT");
  assert.equal(safeCliErrorCode({ get code() { throw secret; } }, "BACKUP_FAILED"), "BACKUP_FAILED");
});


test("operator commands and workers redact startup failures", () => {
  const root = mkdtempSync(join(tmpdir(), "crm-worker-redaction-"));
  const storageRoot = join(root, "storage");
  mkdirSync(storageRoot);
  try {
    for (const script of ["migrate.mjs", "file-write-drain.mjs", "backup-restore-check.mjs",
      "reminder-worker.mjs", "backup-worker.mjs"]) {
      const result = spawnSync(process.execPath, [join(import.meta.dirname, script), script === "file-write-drain.mjs" ? "status" : "--healthcheck"], {
        encoding: "utf8", timeout: 15_000,
        env: { PATH: process.env.PATH, DATABASE_URL: "postgresql://probe:probe-secret@127.0.0.1:1/probe",
          DOCUMENT_STORAGE_ROOT: storageRoot, BACKUP_ROOT: join(root, "backups") },
      });
      assert.equal(result.status, 1, `${script}: ${result.error?.code ?? "unexpected status"}`);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /probe-secret|postgresql:|at .*\.mjs/);
      const line = JSON.parse(result.stderr.trim());
      assert.equal(line.status, "failed");
      assert.match(line.errorCode, /^(ECONNREFUSED|MIGRATION_FAILED|FILE_WRITE_DRAIN_FAILED|BACKUP_RESTORE_CHECK_FAILED|BACKUP_WORKER_FAILED|REMINDER_WORKER_FAILED)$/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
