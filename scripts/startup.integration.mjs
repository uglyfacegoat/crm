import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";

const runtimeEnvironment = {
  ...process.env,
  NODE_ENV: "production",
  AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: "http://127.0.0.1:3100",
  AUTH_COOKIE_SECURE: "true",
  AUTH_THROTTLE_SECRET: "test-only-startup-validation-secret-32-characters",
  DATABASE_URL: "postgresql://crm:do-not-log-this@127.0.0.1:1/crm",
  DOCUMENT_STORAGE_ROOT: resolve(tmpdir(), "crm-startup-test"),
  CRM_WEBSITE_WEBHOOK_SECRET: "",
  HOSTNAME: "127.0.0.1",
};

for (const key of ["AUTH_MODE", "AUTH_THROTTLE_SECRET", "DATABASE_URL", "DOCUMENT_STORAGE_ROOT", "CRM_ALLOWED_ORIGINS"]) {
  test(`standalone server refuses to start without ${key}`, async () => {
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = probe.address().port;
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    const environment = { ...runtimeEnvironment, PORT: String(port) };
    delete environment[key];
    const result = spawnSync(process.execPath, [".next/standalone/server.js"], {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
      killSignal: "SIGKILL",
    });
    assert.equal(result.error, undefined, "Invalid configuration must exit promptly, not hang until the timeout");
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`Invalid runtime configuration: ${key}`));
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-log-this/);
  });
}
