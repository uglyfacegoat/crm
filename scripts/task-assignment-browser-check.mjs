import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.TASK_CHECK_RUNTIME || !process.env.CHROME_PATH) {
  throw new Error("Run with isolated PostgreSQL, TASK_CHECK_RUNTIME and CHROME_PATH.");
}

const baseUrl = "http://127.0.0.1:3134";
const directory = await mkdtemp(join(tmpdir(), "crm-task-browser-"));
const databaseName = `crm_task_browser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const accounts = {
  developer: { email: "developer@task-browser.invalid", password: randomBytes(32).toString("hex") },
  max: { email: "max@task-browser.invalid", password: randomBytes(32).toString("hex"), name: "Макс", role: "owner" },
  liza: { email: "liza@task-browser.invalid", password: randomBytes(32).toString("hex"), name: "Лиза", role: "crm_coordinator" },
  departed: { email: "departed@task-browser.invalid", password: randomBytes(32).toString("hex"), name: "Бывший сотрудник", role: "crm_coordinator" },
};
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Task developer", AUTH_BOOTSTRAP_ADMIN_EMAIL: accounts.developer.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: accounts.developer.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Task browser acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3134" };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false;

async function login(page, account) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(account.email);
  await page.getByPlaceholder("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname === "/");
}

function doNotOverlap(first, second) {
  return first.x + first.width <= second.x || second.x + second.width <= first.x ||
    first.y + first.height <= second.y || second.y + second.height <= first.y;
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const [organization] = await sql`SELECT organization_id FROM organization_members WHERE email = ${accounts.developer.email}`;
  for (const account of [accounts.max, accounts.liza, accounts.departed]) {
    const createdMember = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
      env: { ...environment, AUTH_MEMBER_ORGANIZATION_ID: organization.organization_id,
        AUTH_MEMBER_NAME: account.name, AUTH_MEMBER_EMAIL: account.email,
        AUTH_MEMBER_PASSWORD: account.password, AUTH_MEMBER_ROLE: account.role }, stdio: "inherit",
    });
    assert.equal(createdMember.status, 0);
    const [member] = await sql`SELECT id FROM organization_members WHERE organization_id = ${organization.organization_id} AND email = ${account.email}`;
    account.id = member.id;
  }

  const runtime = resolve(process.env.TASK_CHECK_RUNTIME);
  await cp(join(dirname(dirname(runtime)), "static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
  await cp(resolve("public"), join(dirname(runtime), "public"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const maxPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(maxPage, accounts.max);
  await maxPage.goto(`${baseUrl}/tasks`);
  await maxPage.getByRole("button", { name: "Новая задача", exact: true }).click();
  const dialog = maxPage.getByRole("dialog", { name: "Новая задача", exact: true });
  await dialog.locator('input[name="title"]').fill("Проверить CRM для Лизы");
  await dialog.locator('summary[aria-label="Исполнитель"]').click();
  await dialog.getByPlaceholder("Имя или email").fill("Лиза");
  await dialog.getByRole("button", { name: /Лиза/ }).click();
  assert.equal(await dialog.locator('input[name="assignedMemberId"]').inputValue(), accounts.liza.id);
  await dialog.locator('input[data-form-name="localDate"]').fill("30.10.2026");
  await dialog.locator('input[data-form-name="localTime"]').fill("14:30");
  assert.equal(await dialog.locator('input[name="localDate"]').inputValue(), "2026-10-30");
  assert.equal(await dialog.locator('input[name="localTime"]').inputValue(), "14:30");
  for (const width of [390, 768, 1440]) {
    await maxPage.setViewportSize({ width, height: 900 });
    const date = await dialog.locator('input[data-form-name="localDate"]').boundingBox();
    const time = await dialog.locator('input[data-form-name="localTime"]').boundingBox();
    assert.ok(date && time && doNotOverlap(date, time), `Deadline fields overlap at ${width}px`);
    assert.equal(await maxPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  }
  await dialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const [lizaTask] = await sql`SELECT id, assigned_member_id, due_at FROM tasks WHERE title = 'Проверить CRM для Лизы'`;
  assert.equal(lizaTask.assigned_member_id, accounts.liza.id);
  assert.ok(lizaTask.due_at);

  await maxPage.setViewportSize({ width: 1440, height: 900 });
  await maxPage.getByRole("button", { name: "Новая задача", exact: true }).click();
  const selfDialog = maxPage.getByRole("dialog", { name: "Новая задача", exact: true });
  await selfDialog.locator('input[name="title"]').fill("Проверить CRM для Макса");
  assert.equal(await selfDialog.locator('input[name="assignedMemberId"]').inputValue(), accounts.max.id);
  await selfDialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await selfDialog.waitFor({ state: "hidden" });
  const [selfTask] = await sql`SELECT id, assigned_member_id FROM tasks WHERE title = 'Проверить CRM для Макса'`;
  assert.equal(selfTask.assigned_member_id, accounts.max.id);
  await maxPage.reload();
  await maxPage.getByText("Автоматических: 0 · ручных: 2").waitFor();
  await maxPage.getByRole("button", { name: "Фильтры" }).click();
  const filtersDialog = maxPage.getByRole("dialog", { name: "Фильтры задач" });
  await filtersDialog.locator('summary[aria-label="Исполнитель"]').click();
  await filtersDialog.getByPlaceholder("Имя или email").fill("Лиза");
  await filtersDialog.getByRole("button", { name: /Лиза/ }).click();
  await filtersDialog.getByRole("button", { name: "Применить" }).click();
  await maxPage.getByRole("heading", { name: "Проверить CRM для Лизы" }).waitFor();
  assert.equal(await maxPage.getByRole("heading", { name: "Проверить CRM для Макса" }).count(), 0);
  await maxPage.getByRole("button", { name: /Фильтры/ }).click();
  await filtersDialog.getByRole("button", { name: "Сбросить" }).click();
  await filtersDialog.getByRole("button", { name: "Применить" }).click();
  await maxPage.getByRole("tab", { name: /Мои задачи/ }).click();
  await maxPage.getByRole("heading", { name: "Проверить CRM для Макса" }).waitFor();
  assert.equal(await maxPage.getByRole("heading", { name: "Проверить CRM для Лизы" }).count(), 0);

  for (const width of [390, 768, 1440]) {
    await maxPage.setViewportSize({ width, height: 900 });
    const menuButton = maxPage.getByRole("button", { name: "Меню задачи Проверить CRM для Макса" });
    await menuButton.scrollIntoViewIfNeeded();
    await maxPage.waitForTimeout(150);
    await menuButton.click();
    const menu = maxPage.getByRole("menu", { name: "Действия с задачей Проверить CRM для Макса" });
    await menu.waitFor({ state: "visible" });
    const insideCard = await menu.evaluate((element) => Boolean(element.closest(".tasks-row")));
    assert.equal(insideCard, false, `Task menu must escape the card at ${width}px`);
    const box = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    });
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1, `Task menu clipped horizontally at ${width}px`);
    await maxPage.keyboard.press("Escape");
  }

  const lizaPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(lizaPage, accounts.liza);
  await lizaPage.goto(`${baseUrl}/tasks`);
  await lizaPage.getByRole("tab", { name: /Мои задачи/ }).click();
  await lizaPage.getByRole("heading", { name: "Проверить CRM для Лизы" }).waitFor();
  assert.equal(await lizaPage.getByRole("heading", { name: "Проверить CRM для Макса" }).count(), 0);
  assert.equal(await lizaPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await sql`INSERT INTO tasks (organization_id, title, due_at, assigned_member_id)
    SELECT ${organization.organization_id}, 'Другая просроченная задача ' || n, now() - interval '1 day', ${accounts.max.id}
    FROM generate_series(1, 510) AS n`;
  await lizaPage.reload();
  await lizaPage.getByRole("tab", { name: /Мои задачи/ }).click();
  await lizaPage.getByRole("heading", { name: "Проверить CRM для Лизы" }).waitFor();
  assert.equal(await lizaPage.getByRole("tab", { name: /Мои задачи 1/ }).count(), 1);
  assert.equal(await lizaPage.getByRole("heading", { name: /Другая просроченная задача/ }).count(), 0);
  await sql`INSERT INTO tasks (organization_id, title, priority, due_at, assigned_member_id, created_at)
    SELECT ${organization.organization_id},
      CASE WHEN n = 520 THEN 'Янтарная личная задача за пределом 500' ELSE 'Личная задача ' || n END,
      CASE WHEN n = 520 THEN 'high' ELSE 'normal' END,
      CASE WHEN n = 520 THEN now() + interval '2 days' ELSE NULL END,
      ${accounts.liza.id}, now() - n * interval '1 minute'
      FROM generate_series(1, 520) AS n`;
  await maxPage.goto(`${baseUrl}/tasks`);
  await maxPage.getByRole("tab", { name: /Все задачи 1032/ }).waitFor();
  const allSearch = maxPage.getByPlaceholder("Задача, заказ, описание или сотрудник");
  await allSearch.fill("Янтарная личная");
  await maxPage.getByRole("heading", { name: "Янтарная личная задача за пределом 500" }).waitFor();
  assert.equal(await maxPage.getByRole("tab", { name: /Все задачи 1/ }).count(), 1);
  const deepAll = await maxPage.request.get(`${baseUrl}/api/v1/tasks/list?page=20`);
  assert.equal(deepAll.status(), 200);
  assert.ok((await deepAll.json()).data.tasks.some((task) => task.title === "Янтарная личная задача за пределом 500"));
  await allSearch.fill("");
  await maxPage.getByRole("tab", { name: /Все задачи 1032/ }).waitFor();
  await maxPage.getByRole("button", { name: /Показать ещё/ }).click();
  await maxPage.getByText("Показаны 100 из 1032 задач").waitFor();
  for (const width of [390, 768, 1440]) {
    await maxPage.setViewportSize({ width, height: 900 });
    assert.equal(await maxPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false,
      `Paginated all tasks overflow at ${width}px`);
  }
  await lizaPage.reload();
  await lizaPage.getByRole("tab", { name: /Мои задачи 521/ }).click();
  const mineSearch = lizaPage.getByPlaceholder("Задача, заказ, описание или сотрудник");
  await mineSearch.fill("Янтарная личная");
  await lizaPage.getByRole("heading", { name: "Янтарная личная задача за пределом 500" }).waitFor();
  assert.equal(await lizaPage.getByRole("tab", { name: /Мои задачи 1/ }).count(), 1);
  const deepMine = await lizaPage.request.get(`${baseUrl}/api/v1/tasks/mine?page=10`);
  assert.equal(deepMine.status(), 200);
  assert.ok((await deepMine.json()).data.tasks.some((task) => task.title === "Янтарная личная задача за пределом 500"));
  const maxCannotReadLiza = await maxPage.request.get(`${baseUrl}/api/v1/tasks/mine?q=${encodeURIComponent("Янтарная личная")}`);
  assert.equal((await maxCannotReadLiza.json()).data.total, 0);
  await mineSearch.fill("");
  await lizaPage.getByRole("tab", { name: /Мои задачи 521/ }).waitFor();
  await lizaPage.getByRole("button", { name: /Показать ещё/ }).click();
  await lizaPage.getByText("Показаны 100 из 521 задач").waitFor();
  for (const width of [390, 768, 1440]) {
    await lizaPage.setViewportSize({ width, height: 900 });
    assert.equal(await lizaPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false,
      `Paginated personal tasks overflow at ${width}px`);
  }
  await lizaPage.setViewportSize({ width: 390, height: 844 });
  const [departedTask] = await sql`INSERT INTO tasks (organization_id, title, assigned_member_id)
    VALUES (${organization.organization_id}, 'Вернуть задачу в работу', ${accounts.departed.id}) RETURNING id`;
  await sql`UPDATE organization_members SET active = false WHERE id = ${accounts.departed.id}`;
  await maxPage.reload();
  await maxPage.getByRole("tab", { name: /Без исполнителя 1/ }).click();
  await maxPage.getByRole("heading", { name: "Вернуть задачу в работу" }).waitFor();
  for (const width of [390, 768, 1440]) {
    await maxPage.setViewportSize({ width, height: 900 });
    assert.equal(await maxPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false,
      `Recovery tab overflows at ${width}px`);
  }
  await maxPage.getByRole("button", { name: "Открыть", exact: true }).click();
  const recoveryDialog = maxPage.getByRole("dialog", { name: /Редактировать задачу/ });
  await recoveryDialog.getByText(/Прежний исполнитель отключён/).waitFor();
  await recoveryDialog.locator('summary[aria-label="Ответственный"]').click();
  await recoveryDialog.getByPlaceholder("Имя или email").fill("Лиза");
  await recoveryDialog.getByRole("button", { name: /Лиза/ }).click();
  await recoveryDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await recoveryDialog.waitFor({ state: "hidden" });
  const [reassigned] = await sql`SELECT assigned_member_id FROM tasks WHERE id = ${departedTask.id}`;
  assert.equal(reassigned.assigned_member_id, accounts.liza.id);
  await lizaPage.goto(`${baseUrl}/tasks`);
  await lizaPage.getByRole("tab", { name: /Мои задачи/ }).click();
  await lizaPage.getByRole("heading", { name: "Вернуть задачу в работу" }).waitFor();
  await lizaPage.goto(`${baseUrl}/notifications`);
  await lizaPage.getByText("Вам назначена задача").first().waitFor();
  await lizaPage.getByText("Проверить CRM для Лизы").waitFor();
  await sql`INSERT INTO tasks (organization_id, title, assigned_member_id, created_at)
    SELECT ${organization.organization_id},
      CASE WHEN n = 520 THEN 'Янтарная задача без исполнителя' ELSE 'Без исполнителя ' || n END,
      NULL, now() - n * interval '1 minute' FROM generate_series(1, 520) AS n`;
  await maxPage.goto(`${baseUrl}/tasks`);
  await maxPage.getByRole("tab", { name: /Без исполнителя 520/ }).click();
  const strandedSearch = maxPage.getByPlaceholder("Задача, заказ, описание или сотрудник");
  await strandedSearch.fill("Янтарная задача без исполнителя");
  await maxPage.getByRole("heading", { name: "Янтарная задача без исполнителя" }).waitFor();
  const deepStranded = await maxPage.request.get(`${baseUrl}/api/v1/tasks/stranded?page=10`);
  assert.equal(deepStranded.status(), 200);
  assert.ok((await deepStranded.json()).data.tasks.some((task) => task.title === "Янтарная задача без исполнителя"));
  await strandedSearch.fill("Задача, которой точно нет");
  await maxPage.getByRole("tab", { name: /Без исполнителя 0/ }).waitFor();
  assert.equal(await maxPage.getByRole("tab", { name: /Без исполнителя 0/ }).count(), 1);
  await strandedSearch.fill("");
  await maxPage.getByRole("tab", { name: /Без исполнителя 520/ }).waitFor();
  await maxPage.getByRole("button", { name: /Показать ещё/ }).click();
  await maxPage.getByText("Показаны 100 из 520 задач").waitFor();
  for (const width of [390, 768, 1440]) {
    await maxPage.setViewportSize({ width, height: 900 });
    assert.equal(await maxPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false,
      `Paginated unassigned tasks overflow at ${width}px`);
  }
  console.log("Task browser passed: assignments, notification, 1032 all tasks, 521 personal tasks and 520 unassigned tasks with server search and loading more, recovery and reassignment from an inactive member, and 390/768/1440px layouts.");
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  if (sql) await sql.end();
  if (created) { await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`; }
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
