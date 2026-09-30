import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres from "postgres";
import { hashEmailOtpCode } from "../src/server/auth/email-otp-code.mjs";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || adminUrl !== process.env.CRM_TEST_FIXTURE_URL || !process.env.EMAIL_OTP_CHECK_RUNTIME) {
  throw new Error("Run with an isolated PostgreSQL fixture and EMAIL_OTP_CHECK_RUNTIME.");
}
const baseUrl = "http://127.0.0.1:3121";
const databaseName = `crm_email_otp_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${databaseName}`;
const directory = await mkdtemp(join(tmpdir(), "crm-email-otp-"));
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const email = "email-otp-check@example.invalid";
const password = randomBytes(32).toString("hex");
const secret = randomBytes(32).toString("hex");
const environment = { ...process.env, DATABASE_URL: databaseUrl.toString(), AUTH_MODE: "required",
  AUTH_EMAIL_OTP_ENABLED: "true", AUTH_EMAIL_OTP_SECRET: secret,
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"),
  AUTH_BOOTSTRAP_ADMIN_NAME: "Email OTP test", AUTH_BOOTSTRAP_ADMIN_EMAIL: email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Email OTP test",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  DOCUMENT_STORAGE_ROOT: directory, NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3121" };
let sql; let server; let created = false;

async function post(path, body, cookie = "") {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { Origin: baseUrl,
    "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: databaseUrl.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"],
    { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(databaseUrl.toString(), { max: 2, onnotice: () => {} });
  const runtime = resolve(process.env.EMAIL_OTP_CHECK_RUNTIME);
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await Promise.race([
    new Promise((done, reject) => {
      server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) done(); });
      server.once("exit", (code) => reject(new Error(`Server exited ${code}`)));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Server startup timed out")), 30_000)),
  ]);

  const unavailable = await post("/api/v1/auth/login", { identity: email, password });
  assert.equal(unavailable.status, 200, "Email OTP is opt-in for each member");
  const baselineSession = unavailable.headers.get("set-cookie")?.match(/crm_session=[^;]+/)?.[0];
  assert.ok(baselineSession);
  await sql`UPDATE member_credentials SET email_otp_enabled = true`;
  const unavailableWithOtp = await post("/api/v1/auth/login", { identity: email, password });
  assert.equal(unavailableWithOtp.status, 503, "No session when outbound mail worker is not ready");
  assert.equal(unavailableWithOtp.headers.get("set-cookie"), null);

  await sql`INSERT INTO background_job_status (job_name, status, heartbeat_at, last_started_at, last_result)
    VALUES ('mail.inbox', 'succeeded', now(), now(), ${sql.json({ otpReady: true, smtpReady: true })})`;
  const login = await post("/api/v1/auth/login", { identity: email, password });
  assert.equal(login.status, 202);
  assert.equal((await login.json()).data.emailCodeRequired, true);
  const pendingCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.match(pendingCookie, /^crm_email_challenge=/);
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: pendingCookie } })).status, 401);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM auth_sessions`)[0].count, 1);

  const [challenge] = await sql`SELECT id FROM auth_email_challenges ORDER BY created_at DESC LIMIT 1`;
  const code = "4826173";
  await sql`UPDATE auth_email_challenges SET status = 'sent', sent_at = now(),
    code_hash = ${hashEmailOtpCode(secret, challenge.id, code)} WHERE id = ${challenge.id}`;
  const wrong = await post("/api/v1/auth/verify-email-code", { code: "0000000" }, pendingCookie);
  assert.equal(wrong.status, 401);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM auth_sessions`)[0].count, 1);
  const valid = await post("/api/v1/auth/verify-email-code", { code }, pendingCookie);
  assert.equal(valid.status, 200);
  const sessionCookie = valid.headers.get("set-cookie")?.match(/crm_session=[^;]+/)?.[0];
  assert.ok(sessionCookie);
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: sessionCookie } })).status, 200);
  assert.equal((await post("/api/v1/auth/verify-email-code", { code }, pendingCookie)).status, 401,
    "A code cannot create a second session");
  assert.equal((await sql`SELECT count(*)::integer AS count FROM auth_sessions`)[0].count, 2);

  const secondLogin = await post("/api/v1/auth/login", { identity: email, password });
  assert.equal(secondLogin.status, 202);
  const secondCookie = secondLogin.headers.get("set-cookie")?.split(";")[0];
  const [secondChallenge] = await sql`SELECT id FROM auth_email_challenges ORDER BY created_at DESC, id DESC LIMIT 1`;
  await sql`UPDATE auth_email_challenges SET status = 'sent', sent_at = now(),
    code_hash = ${hashEmailOtpCode(secret, secondChallenge.id, code)} WHERE id = ${secondChallenge.id}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await post("/api/v1/auth/verify-email-code", { code: "0000000" }, secondCookie)).status, 401);
  }
  assert.equal((await post("/api/v1/auth/verify-email-code", { code }, secondCookie)).status, 401,
    "Five invalid codes close the challenge");
  assert.equal((await sql`SELECT count(*)::integer AS count FROM auth_sessions`)[0].count, 2);
} finally {
  if (server?.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit").catch(() => {}); }
  if (sql) await sql.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
