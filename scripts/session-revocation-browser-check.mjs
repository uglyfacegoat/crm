import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password.ts";
import { hashSessionToken } from "../src/server/auth/token.ts";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
const runtime = process.env.SESSION_CHECK_RUNTIME;
if (!adminUrl || !runtime) throw new Error("Set isolated MIGRATION_TEST_ADMIN_URL and SESSION_CHECK_RUNTIME.");
const baseUrl = "http://127.0.0.1:3100";
const directory = await mkdtemp(join(tmpdir(), "crm-session-revocation-"));
const databaseName = `crm_session_revocation_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const adminEmail = "session-admin@example.invalid";
const targetEmail = "session-target@example.invalid";
const adminPassword = randomBytes(32).toString("hex");
const targetPassword = randomBytes(32).toString("hex");
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), CRM_WEBSITE_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: adminPassword, AUTH_BOOTSTRAP_ADMIN_EMAIL: adminEmail,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Session administrator", AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Session test company",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", DOCUMENT_STORAGE_ROOT: directory,
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3100",
};
let databaseCreated = false;
let sql;
let server;
let serverExit;
let browser;

async function login(page, email, password) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(email);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function sessionStatus(page) {
  return page.evaluate(async () => (await fetch("/api/v1/auth/session", { cache: "no-store" })).status);
}

async function saveAccess(page, targetId, { role, active }) {
  await page.goto(`${baseUrl}/settings/users/${targetId}`);
  await page.getByRole("heading", { name: "Session target", exact: true }).waitFor();
  if (role) {
    await page.getByRole("button", { name: "Роль сотрудника" }).click();
    await page.getByRole("option", { name: role, exact: true }).click();
  }
  if (!active) await page.locator('input[name="active"]').uncheck();
  await page.getByRole("button", { name: "Сохранить доступ", exact: true }).click();
  await page.getByText("Доступ сотрудника обновлён. Его активные сессии завершены.").waitFor();
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  databaseCreated = true;
  await runMigrations({ databaseUrl: databaseUrl.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], {
    env: environment, stdio: "inherit",
  });
  assert.equal(bootstrap.status, 0, "Test administrator bootstrap failed");
  sql = postgres(databaseUrl.toString(), { max: 2, onnotice: () => {} });
  const [organization] = await sql`SELECT organization_id FROM organization_members WHERE email = ${adminEmail}`;
  const passwordHash = await hashPassword(targetPassword);
  const [target] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.organization_id}, 'Session target', ${targetEmail}, 'admin') RETURNING id`;
  await sql`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at)
    VALUES (${organization.organization_id}, ${target.id}, 'email', ${targetEmail}, now())`;
  await sql`INSERT INTO member_credentials (organization_id, member_id, password_hash)
    VALUES (${organization.organization_id}, ${target.id}, ${passwordHash})`;
  const [otherOrganization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Session principal company', 'Europe/Moscow') RETURNING id`;
  const [principal] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${otherOrganization.id}, 'Cross-company principal', 'principal@example.invalid', 'admin') RETURNING id`;
  await sql`INSERT INTO organization_access_grants
    (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${otherOrganization.id}, ${principal.id}, ${organization.organization_id}, ${target.id})`;
  const crossCompanyToken = randomBytes(32).toString("base64url");
  await sql`INSERT INTO auth_sessions
    (organization_id, member_id, token_hash, active_organization_id, active_member_id, expires_at)
    VALUES (${otherOrganization.id}, ${principal.id}, ${hashSessionToken(crossCompanyToken)},
      ${organization.organization_id}, ${target.id}, now() + interval '1 day')`;

  server = spawn(process.execPath, [resolve(runtime)], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); }
    });
  });

  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const actorPage = await browser.newPage();
  const targetPages = [await browser.newPage(), await browser.newPage()];
  await login(actorPage, adminEmail, adminPassword);
  for (const page of targetPages) {
    await login(page, targetEmail, targetPassword);
    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("heading", { name: "Настройки", exact: true }).waitFor();
    assert.equal(await sessionStatus(page), 200);
  }
  const crossCompanySession = () => fetch(`${baseUrl}/api/v1/auth/session`, {
    headers: { cookie: `crm_session=${crossCompanyToken}` }, signal: AbortSignal.timeout(10_000),
  });
  assert.equal((await crossCompanySession()).status, 200);

  await saveAccess(actorPage, target.id, { role: "Диспетчер", active: true });
  assert.equal((await crossCompanySession()).status, 401, "An active cross-company session must also be revoked");
  for (const page of targetPages) {
    assert.equal(await sessionStatus(page), 401, "An already open tab must lose its server-side session");
    await page.goto(`${baseUrl}/settings`);
    await page.waitForURL((url) => url.pathname === "/login");
  }
  assert.equal(Number((await sql`SELECT count(*) FROM auth_sessions
    WHERE organization_id = ${organization.organization_id} AND member_id = ${target.id} AND revoked_at IS NULL`)[0].count), 0);

  await login(targetPages[0], targetEmail, targetPassword);
  const currentRole = await targetPages[0].evaluate(async () => (await (await fetch("/api/v1/auth/session")).json()).data.role);
  assert.equal(currentRole, "dispatcher", "A fresh login must receive the changed role");
  await targetPages[0].goto(`${baseUrl}/settings`);
  await targetPages[0].waitForURL((url) => url.pathname === "/");

  await saveAccess(actorPage, target.id, { role: null, active: false });
  assert.equal(await sessionStatus(targetPages[0]), 401, "Deactivation must revoke the current open tab");
  await targetPages[0].goto(`${baseUrl}/login`);
  await targetPages[0].getByPlaceholder("Email или телефон").fill(targetEmail);
  await targetPages[0].getByPlaceholder("Пароль").fill(targetPassword);
  await targetPages[0].getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await targetPages[0].getByText("Неверный логин или пароль.").waitFor();
  assert.equal(Number((await sql`SELECT count(*) FROM auth_sessions
    WHERE organization_id = ${organization.organization_id} AND member_id = ${target.id} AND revoked_at IS NULL`)[0].count), 0);
  console.log("Session revocation passed: two open tabs and cross-company scope revoked on role change; new role applied; deactivation revoked the fresh session and prevented login.");
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  await sql?.end();
  try { if (databaseCreated) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
}
