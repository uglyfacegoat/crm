import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

const image = process.env.CRM_ROLLBACK_IMAGE;
const databaseUrl = process.env.DATABASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!image || !databaseUrl || !identity || !password) throw new Error("A previous image and disposable runtime credentials are required.");
const containerDatabase = new URL(databaseUrl);
if (!/^\/crm_smoke_[a-f0-9]{32}$/.test(containerDatabase.pathname)) throw new Error("Rollback rehearsal requires a disposable crm_smoke database.");
if (["127.0.0.1", "localhost"].includes(containerDatabase.hostname)) containerDatabase.hostname = "host.docker.internal";
const origin = "http://127.0.0.1:3110";
const name = `crm-rollback-${randomUUID().slice(0, 8)}`;
const sql = postgres(databaseUrl, { max: 1 });
const environment = {
  ...process.env,
  DATABASE_URL: containerDatabase.toString(),
  AUTH_MODE: "required", CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  CRM_ALLOWED_ORIGINS: origin, DOCUMENT_STORAGE_ROOT: "/app/storage", HOSTNAME: "0.0.0.0", PORT: "3000",
};
const docker = (...args) => execFileSync("docker", args, { env: environment, encoding: "utf8", timeout: 30_000 });
let created = false;
let cookie;
try {
  const before = await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`;
  assert.ok(before.some((migration) => migration.name === "054_request_rate_limits.sql"));
  const envArgs = ["DATABASE_URL", "AUTH_MODE", "AUTH_THROTTLE_SECRET", "CRM_TRUST_PROXY", "AUTH_COOKIE_SECURE", "CRM_ALLOWED_ORIGINS", "DOCUMENT_STORAGE_ROOT", "HOSTNAME", "PORT"]
    .flatMap((key) => ["--env", key]);
  docker("create", "--name", name, "--publish", "127.0.0.1:3110:3000", ...envArgs,
    "--mount", `type=bind,source=${resolve("db/migrations")},target=/app/db/migrations,readonly`, image);
  created = true;
  docker("start", name);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const running = docker("inspect", name, "--format", "{{.State.Running}}").trim();
    assert.equal(running, "true", "Rollback image must pass its configuration and migration guards");
    try {
      ready = (await fetch(`${origin}/api/v1/system/health`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch (error) {
      // Connection refusal is expected until the isolated container starts listening.
      if (!(error instanceof TypeError) && error.name !== "TimeoutError") throw error;
    }
    if (ready) break;
    await delay(1000);
  }
  assert.ok(ready, "Rollback image must become healthy within 30 seconds");
  const login = await fetch(`${origin}/api/v1/auth/login`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ identity, password }), signal: AbortSignal.timeout(15_000),
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  for (const path of ["/tasks", "/clients", "/api/v1/search?q=rollback"]) {
    const response = await fetch(`${origin}${path}`, { headers: { cookie }, signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, `${path} must work on the previous code with the new schema`);
    assert.doesNotMatch(await response.text(), /NEXT_HTTP_ERROR_FALLBACK;500|data-next-error-message=/);
  }
  assert.deepEqual(await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`, before);
  console.log(`Rollback smoke passed for ${image}: normal entrypoint, current migration bundle, unchanged schema history, login, tasks, clients and search.`);
} finally {
  try {
    if (cookie) {
      const logout = await fetch(`${origin}/api/v1/auth/logout`, { method: "POST", headers: { origin, cookie }, signal: AbortSignal.timeout(15_000) });
      assert.equal(logout.status, 200);
    }
  } finally {
    try { if (created) docker("rm", "--force", name); }
    finally { await sql.end(); }
  }
}
