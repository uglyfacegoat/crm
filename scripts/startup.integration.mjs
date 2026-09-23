import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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

test("liveness survives a database outage while readiness fails without exposing configuration", async () => {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [".next/standalone/server.js"], {
    env: { ...runtimeEnvironment, PORT: String(port), CRM_ALLOWED_ORIGINS: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    let live;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error("Standalone server exited before liveness check.");
      try {
        live = await fetch(`${origin}/api/v1/system/live`, { signal: AbortSignal.timeout(1000) });
        if (live.ok) break;
      } catch { /* The standalone server may still be starting. */ }
      await delay(100);
    }
    assert.equal(live?.status, 200);
    assert.deepEqual(await live.json(), { status: "ok", service: "crm-web" });
    assert.equal(live.headers.get("cache-control"), "no-store");
    for (const path of ["ready", "health"]) {
      const response = await fetch(`${origin}/api/v1/system/${path}`, { signal: AbortSignal.timeout(15_000) });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: "unavailable", service: "crm-web", database: "unavailable" });
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.doesNotMatch(output, /do-not-log-this/);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { await exited; } finally { clearTimeout(timeout); }
    }
  }
});
