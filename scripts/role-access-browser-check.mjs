import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import sharp from "sharp";
import { hashPassword } from "../src/server/auth/password.ts";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.ROLE_CHECK_RUNTIME || !process.env.CHROME_PATH) {
  throw new Error("Run with isolated PostgreSQL, ROLE_CHECK_RUNTIME and CHROME_PATH.");
}
const baseUrl = "http://127.0.0.1:3113";
const directory = await mkdtemp(join(tmpdir(), "crm-role-check-"));
const databaseName = `crm_role_check_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const credentials = Object.fromEntries(["developer", "admin", "dispatcher", "manager", "accountant", "master"]
  .map((role) => [role, { email: `${role}@role-check.example.invalid`, password: randomBytes(32).toString("hex") }]));
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Role developer", AUTH_BOOTSTRAP_ADMIN_EMAIL: credentials.developer.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: credentials.developer.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Role acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3113" };
let sql; let server; let serverExit; let browser; let created = false;

async function login(page, role) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(credentials[role].email);
  await page.getByPlaceholder("Пароль").fill(credentials[role].password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname !== "/login");
  const result = await page.evaluate(async () => (await (await fetch("/api/v1/auth/session")).json()).data);
  assert.equal(result.role, role);
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const [organization] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${credentials.developer.email}`;
  for (const role of ["admin", "dispatcher", "manager", "accountant", "master"]) {
    const identity = credentials[role];
    const master = role === "master" ? (await sql`INSERT INTO masters
      (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
      VALUES (${organization.organization_id}, 'Role test master', '+70000000001', '+70000000001', 'Moscow', 'Center') RETURNING id`)[0] : null;
    const [row] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
      VALUES (${organization.organization_id}, ${`Role ${role}`}, ${identity.email}, ${role}, ${master?.id ?? null}) RETURNING id`;
    await sql`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at)
      VALUES (${organization.organization_id}, ${row.id}, 'email', ${identity.email}, now())`;
    await sql`INSERT INTO member_credentials (organization_id, member_id, password_hash)
      VALUES (${organization.organization_id}, ${row.id}, ${await hashPassword(identity.password)})`;
    identity.memberId = row.id;
  }
  const runtime = resolve(process.env.ROLE_CHECK_RUNTIME);
  await cp(resolve(".next/static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const pages = {};
  const routeResults = [];
  const expectedDestinations = {
    developer: ["/", "/orders", "/calendar", "/finance", "/settings", "/profile", "/chat", "/developer/support"],
    admin: ["/", "/orders", "/calendar", "/profile", "/settings", "/profile", "/chat", "/profile"],
    dispatcher: ["/", "/orders", "/calendar", "/profile", "/settings", "/profile", "/chat", "/profile"],
    manager: ["/", "/orders", "/calendar", "/profile", "/settings", "/profile", "/chat", "/profile"],
    accountant: ["/profile", "/orders", "/profile", "/finance", "/settings", "/profile", "/chat", "/profile"],
    master: ["/my-visits", "/my-visits", "/my-visits", "/my-visits", "/settings", "/my-visits", "/chat", "/profile"],
  };
  const settingsOnly = process.env.ROLE_SETTINGS_ONLY === "true";
  const routes = settingsOnly ? ["/settings"] : ["/", "/orders", "/calendar", "/finance", "/settings", "/workflow", "/chat", "/developer/support"];
  for (const role of ["developer", "admin", "dispatcher", "manager", "accountant", "master"]) {
    const page = await browser.newPage(); pages[role] = page;
    await login(page, role);
    await page.goto(`${baseUrl}/profile`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Мой профиль" }).waitFor();
    const nextName = `Checked ${role}`;
    await page.locator('input[name="displayName"]').fill(nextName);
    if (role === "developer" || role === "master") {
      const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: "#4578aa" } }).png().toBuffer();
      await page.locator('input[name="photo"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
    }
    const analyticsExport = await page.request.get(`${baseUrl}/api/v1/analytics/export?range=30`);
    assert.equal(analyticsExport.status(), ["developer", "accountant"].includes(role) ? 200 : 403,
      `${role} analytics export permission`);
    const orderPicker = await page.request.get(`${baseUrl}/api/v1/orders/options?type=clients`);
    assert.equal(orderPicker.status(), ["developer", "admin", "dispatcher", "manager"].includes(role) ? 200 : 403,
      `${role} order picker permission`);
    await page.getByRole("button", { name: "Сохранить профиль" }).click();
    await page.getByRole("heading", { name: "Мой профиль" }).waitFor();
    await page.waitForFunction((name) => document.body.textContent.includes(name), nextName);
    let saved;
    for (let attempt = 0; attempt < 30; attempt++) {
      [saved] = await sql`SELECT display_name FROM organization_members WHERE email = ${credentials[role].email}`;
      if (saved.display_name === nextName) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.equal(saved.display_name, nextName);
    await page.waitForTimeout(350);
    if (role === "developer" || role === "master") {
      const response = await page.request.get(`${baseUrl}/api/v1/profile/avatar`);
      assert.equal(response.status(), 200);
      assert.equal(response.headers()["content-type"], "image/webp");
    }
    for (const [index, path] of routes.entries()) {
      const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
      const finalPath = new URL(page.url()).pathname;
      assert.equal(response.status(), 200, `${role} ${path} must render or redirect without a server error`);
      assert.equal(finalPath, settingsOnly ? "/settings" : expectedDestinations[role][index], `${role} must have the expected screen access for ${path}`);
      if (path === "/settings") {
        assert.equal(await page.getByRole("tab", { name: "Безопасность" }).count(), 1);
        if (role !== "developer") {
          assert.equal(await page.getByRole("tab", { name: "Пользователи" }).count(), 0,
            `${role} must not see administrative settings`);
        }
      }
      if (path === "/orders" && finalPath === "/orders") {
        assert.equal(await page.getByRole("button", { name: "Новый заказ" }).count(), 0);
      }
      routeResults.push({ role, path, finalPath });
    }
    const activityResponse = await page.request.post(`${baseUrl}/api/v1/profile/activity`, {
      headers: { Origin: baseUrl },
      data: { screen: "profile" },
    });
    assert.equal(activityResponse.status(), 204, `${role} activity heartbeat`);
  }
  if (settingsOnly) {
    console.log("Security settings access passed for all six roles.");
  } else {
  assert.equal(Number((await sql`SELECT count(*) FROM member_screen_activity`)[0].count), 6);
  const adminPage = pages.admin;
  const developerPage = pages.developer;
  await developerPage.goto(`${baseUrl}/settings`);
  await developerPage.getByRole("tab", { name: "Активность" }).click();
  await developerPage.getByRole("heading", { name: "Отчёт по пользователям" }).waitFor();
  assert.equal(await developerPage.getByRole("button", { name: /Checked developer/ }).count(), 1);
  await adminPage.goto(`${baseUrl}/settings`);
  assert.equal(await adminPage.getByRole("tab", { name: "Пользователи" }).count(), 0);
  await adminPage.goto(`${baseUrl}/settings/users/${organization.id}`);
  assert.equal(new URL(adminPage.url()).pathname, "/profile", "Legacy admin must not edit users by direct URL");
  await developerPage.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
  await developerPage.getByRole("tab", { name: "Пользователи" }).click();
  await developerPage.getByText("Системная учётка").waitFor();
  assert.equal(await developerPage.getByRole("link", { name: /Открыть настройки: Checked developer/ }).count(), 0);
  await developerPage.goto(`${baseUrl}/settings/users/${organization.id}`);
  await developerPage.getByRole("heading", { name: "Защищённая учётная запись разработчика" }).waitFor();
  assert.equal(await developerPage.locator('input[name="active"]').count(), 0);
  await developerPage.goto(`${baseUrl}/settings`, { waitUntil: "domcontentloaded" });
  await developerPage.getByRole("tab", { name: "Пользователи" }).click();
  await developerPage.getByRole("button", { name: "Новый сотрудник" }).click();
  const createDialog = developerPage.getByRole("dialog", { name: "Новый сотрудник" });
  await createDialog.locator('input[name="displayName"]').fill("Reserved account attempt");
  await createDialog.locator('input[name="email"]').fill(credentials.developer.email);
  await createDialog.locator('input[name="password"]').fill(randomBytes(24).toString("hex"));
  await createDialog.getByRole("button", { name: "Создать сотрудника" }).click();
  await createDialog.getByText("Этот адрес зарезервирован для системной учётной записи разработчика.").waitFor();
  assert.equal(Number((await sql`SELECT count(*) FROM organization_members WHERE email = ${credentials.developer.email}`)[0].count), 1);
  await developerPage.goto(`${baseUrl}/settings/users/${credentials.accountant.memberId}`, { waitUntil: "domcontentloaded" });
  const financeReadChoice = developerPage.getByRole("combobox", { name: "Финансы: Просматривать" });
  assert.match(await financeReadChoice.locator("option:checked").textContent(), /По роли — разрешено/);
  await financeReadChoice.selectOption("deny");
  await developerPage.waitForFunction(() => document.querySelector('input[name="permissionOverrides"]')?.value.includes('"finance.read":false'));
  await developerPage.getByRole("button", { name: "Сохранить доступ" }).click();
  await developerPage.getByText("Доступ сотрудника обновлён. Его активные сессии завершены.").waitFor();
  const overrides = await sql`SELECT permission, allowed FROM member_permission_overrides WHERE member_id = ${credentials.accountant.memberId}`;
  assert.deepEqual(Array.from(overrides), [{ permission: "finance.read", allowed: false }]);
  assert.equal((await pages.accountant.request.get(`${baseUrl}/api/v1/auth/session`)).status(), 401);
  await login(pages.accountant, "accountant");
  await pages.accountant.goto(`${baseUrl}/finance`);
  assert.equal(new URL(pages.accountant.url()).pathname, "/profile", "Explicit finance denial must close the screen");
  console.log(JSON.stringify({ result: "route-matrix", checked: routeResults.length, roles: Object.keys(pages) }));
  await developerPage.goto(`${baseUrl}/settings/users/${credentials.dispatcher.memberId}`);
  await developerPage.locator('input[name="active"]').uncheck();
  await developerPage.getByRole("button", { name: "Сохранить доступ" }).click();
  let disabled;
  for (let attempt = 0; attempt < 30; attempt++) {
    [disabled] = await sql`SELECT active FROM organization_members WHERE id = ${credentials.dispatcher.memberId}`;
    if (!disabled.active) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  const dispatcherSession = await pages.dispatcher.request.get(`${baseUrl}/api/v1/auth/session`);
  assert.equal(dispatcherSession.status(), 401);
  assert.equal(disabled.active, false);
  console.log("Role access browser check passed: six profiles, protected developer and session-revoking deactivation.");
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  await sql?.end();
  try { if (created) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
}
