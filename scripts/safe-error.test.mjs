import assert from "node:assert/strict";
import { test } from "node:test";
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
