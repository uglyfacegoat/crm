import assert from "node:assert/strict";
import { test } from "node:test";
import { safeErrorCode } from "../src/server/observability/safe-error.ts";

test("safe error codes never serialize exception messages or arbitrary code values", () => {
  const secret = new Error("postgresql://admin:private-password@db.example/crm");
  secret.code = "private-password";
  assert.equal(safeErrorCode(secret), "UNEXPECTED");
  secret.code = "ECONNREFUSED";
  assert.equal(safeErrorCode(secret), "ECONNREFUSED");
  assert.equal(safeErrorCode("private-password"), "NON_ERROR_THROWN");
  assert.equal(safeErrorCode({ get code() { throw new Error("private-password"); } }), "UNEXPECTED");
});
