import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { validateRuntimeEnvironment } from "../src/server/config/environment.ts";

const validEnvironment = {
  NODE_ENV: "production",
  AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: "http://127.0.0.1:3100",
  DATABASE_URL: "postgresql://crm:test-password@127.0.0.1:5432/crm",
  AUTH_THROTTLE_SECRET: "a-test-only-secret-with-at-least-32-characters",
  DOCUMENT_STORAGE_ROOT: resolve(tmpdir(), "crm-config-test"),
};

test("runtime configuration accepts required mode and the explicit local HTTP override", () => {
  assert.doesNotThrow(() => validateRuntimeEnvironment(validEnvironment));
  assert.doesNotThrow(() => validateRuntimeEnvironment({ ...validEnvironment, AUTH_COOKIE_SECURE: "false" }));
});

test("production requires explicit mode and all database-backed application settings", () => {
  for (const key of ["AUTH_MODE", "DATABASE_URL", "AUTH_THROTTLE_SECRET", "DOCUMENT_STORAGE_ROOT", "CRM_ALLOWED_ORIGINS"]) {
    assert.throws(() => validateRuntimeEnvironment({ ...validEnvironment, [key]: undefined }), new RegExp(key));
  }
});

test("trusted production ingress requires HTTPS origins and secure session cookies", () => {
  const proxied = { ...validEnvironment, CRM_TRUST_PROXY: "true", CRM_ALLOWED_ORIGINS: "https://crm.example.invalid" };
  assert.doesNotThrow(() => validateRuntimeEnvironment(proxied));
  assert.throws(() => validateRuntimeEnvironment({ ...proxied, CRM_ALLOWED_ORIGINS: "http://crm.example.invalid" }), /CRM_ALLOWED_ORIGINS/);
  assert.throws(() => validateRuntimeEnvironment({ ...proxied, AUTH_COOKIE_SECURE: "false" }), /AUTH_COOKIE_SECURE/);
});

test("runtime configuration rejects malformed values without leaking them", () => {
  for (const [key, value] of [
    ["AUTH_MODE", "required-but-misspelled"],
    ["AUTH_COOKIE_SECURE", "yes"],
    ["DATABASE_URL", "https://user:secret-in-url@example.invalid/crm"],
    ["DATABASE_URL", "not-a-valid-database-url"],
    ["DATABASE_URL", "postgresql://localhost"],
    ["AUTH_THROTTLE_SECRET", "short-secret"],
    ["AUTH_THROTTLE_SECRET", "replace-with-at-least-32-random-characters"],
    ["AUTH_THROTTLE_SECRET", ` ${"a".repeat(32)}`],
    ["DOCUMENT_STORAGE_ROOT", "relative/storage"],
    ["CRM_WEBSITE_WEBHOOK_SECRET", "short-webhook-secret"],
    ["CRM_TRUST_PROXY", "yes"],
    ["CRM_ALLOWED_ORIGINS", "https://*.example.com"],
    ["CRM_ALLOWED_ORIGINS", "https://example.com/private"],
    ["CRM_ALLOWED_ORIGINS", "https://user:password@example.com"],
    ["CRM_ALLOWED_ORIGINS", "https://example.com,malformed"],
  ]) {
    assert.throws(() => validateRuntimeEnvironment({ ...validEnvironment, [key]: value }), (error) => {
      assert.match(error.message, new RegExp(key));
      assert.ok(!error.message.includes(value));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("development preview and explicitly selected production preview need no database", () => {
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: "development" }));
  assert.doesNotThrow(() => validateRuntimeEnvironment({ NODE_ENV: "production", AUTH_MODE: "preview" }));
  assert.throws(() => validateRuntimeEnvironment({ NODE_ENV: "production" }), /AUTH_MODE/);
});

test("optional website intake may be disabled, but configured secrets must be valid", () => {
  assert.doesNotThrow(() => validateRuntimeEnvironment({ ...validEnvironment, CRM_WEBSITE_WEBHOOK_SECRET: "" }));
  assert.doesNotThrow(() => validateRuntimeEnvironment({ ...validEnvironment, CRM_WEBSITE_WEBHOOK_SECRET: "b".repeat(64) }));
});

test("required file scanning needs a valid private scanner endpoint", () => {
  const scanner = { ...validEnvironment, CRM_FILE_SCAN_MODE: "required", CRM_CLAMD_HOST: "clamav", CRM_CLAMD_PORT: "3310" };
  assert.doesNotThrow(() => validateRuntimeEnvironment(scanner));
  for (const invalid of [
    { CRM_CLAMD_HOST: undefined },
    { CRM_CLAMD_HOST: "http://public.example.invalid" },
    { CRM_CLAMD_PORT: "0" },
    { CRM_CLAMD_TIMEOUT_MS: "not-a-number" },
  ]) assert.throws(() => validateRuntimeEnvironment({ ...scanner, ...invalid }), /CRM_CLAMD/);
});

test("entrypoint rejects configuration before attempting database migrations", () => {
  const result = spawnSync("sh", ["docker-entrypoint.sh"], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, ...validEnvironment, DATABASE_URL: "postgresql://user:do-not-log-this@127.0.0.1:1/crm", AUTH_THROTTLE_SECRET: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid runtime configuration: AUTH_THROTTLE_SECRET/);
  assert.doesNotMatch(result.stderr, /do-not-log-this|ECONNREFUSED|Applied /);
});
