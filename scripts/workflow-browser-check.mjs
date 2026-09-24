import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
const runtime = process.env.WORKFLOW_CHECK_RUNTIME;
if (!adminUrl || !runtime) throw new Error("Set isolated PostgreSQL and WORKFLOW_CHECK_RUNTIME to a built standalone server.js.");
const baseUrl = "http://127.0.0.1:3102";
const databaseName = `crm_workflow_browser_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const storageRoot = await mkdtemp(join(tmpdir(), "crm-workflow-browser-"));
const artifacts = resolve("artifacts/workflow");
await mkdir(artifacts, { recursive: true });
const environment = {
  ...process.env, DATABASE_URL: databaseUrl.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), CRM_WEBSITE_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: randomBytes(32).toString("hex"), AUTH_BOOTSTRAP_ADMIN_EMAIL: "workflow@example.invalid",
  AUTH_BOOTSTRAP_ADMIN_NAME: "Workflow tester", AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Workflow test company",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", DOCUMENT_STORAGE_ROOT: storageRoot,
  DOCUMENT_STORAGE_BACKEND: "local", CRM_FILE_SCAN_MODE: "off", NEXT_TELEMETRY_DISABLED: "1",
  HOSTNAME: "127.0.0.1", PORT: "3102",
};
let created = false;
let sql;
let server;
let browser;
let page;
let reviewerPage;
try {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await runMigrations({ databaseUrl: environment.DATABASE_URL, onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(environment.DATABASE_URL, { max: 2 });
  const [adminMember] = await sql`SELECT id, organization_id FROM organization_members
    WHERE email = ${environment.AUTH_BOOTSTRAP_ADMIN_EMAIL}`;
  const reviewerEmail = "workflow-reviewer@example.invalid";
  const reviewerPassword = randomBytes(32).toString("hex");
  const createReviewer = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
    env: { ...environment, AUTH_MEMBER_ORGANIZATION_ID: adminMember.organization_id,
      AUTH_MEMBER_NAME: "Workflow reviewer", AUTH_MEMBER_EMAIL: reviewerEmail,
      AUTH_MEMBER_PASSWORD: reviewerPassword, AUTH_MEMBER_ROLE: "manager" }, stdio: "inherit",
  });
  assert.equal(createReviewer.status, 0);
  const [reviewerMember] = await sql`SELECT id FROM organization_members WHERE email = ${reviewerEmail}`;
  const [linkedClient] = await sql`INSERT INTO clients (organization_id, legal_name)
    VALUES (${adminMember.organization_id}, 'Клиент воркфлоу') RETURNING id`;
  server = spawn(process.execPath, [resolve(runtime)], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Workflow standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Workflow standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  await page.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`${baseUrl}/workflow`);
  await page.getByText("Карт пока нет.", { exact: false }).waitFor();
  await page.getByLabel("Название новой карты").fill("Путь заявки");
  await page.getByRole("button", { name: "Создать карту" }).click();
  await page.waitForURL((url) => url.pathname === "/workflow" && url.searchParams.has("map"));
  const mapId = new URL(page.url()).searchParams.get("map");
  await page.getByRole("button", { name: "Событие", exact: false }).first().focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Название блока").fill("Новая заявка");
  await page.getByRole("button", { name: "Карточка CRM", exact: false }).first().click();
  await page.getByLabel("Название блока").fill("Заказ в CRM");
  await page.getByLabel("Регламент блока").fill("Проверить заказ перед согласованием");
  await page.getByLabel("Ответственный за блок").selectOption(reviewerMember.id);
  await page.getByLabel("Поиск карточки CRM").fill("Клиент воркфлоу");
  await page.getByRole("button", { name: "Найти карточку" }).click();
  await page.getByRole("button", { name: "Клиент воркфлоу" }).click();
  await page.getByRole("link", { name: /Клиент ·/ }).waitFor();
  await page.getByRole("button", { name: /Событие · 01 Новая заявка/ }).click();
  await page.getByLabel("Следующий блок").selectOption({ label: "Заказ в CRM" });
  await page.getByLabel("Подпись связи").fill("оформить");
  await page.getByRole("button", { name: "Добавить связь" }).click();
  await page.getByRole("button", { name: "Вернуться к карте" }).click();
  await page.getByLabel("Общий регламент").fill("Сначала проверить заявку, затем оформить заказ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Карта сохранена" }).waitFor();
  assert.equal((await sql`SELECT version FROM workflow_maps WHERE id = ${mapId}`)[0].version, 2);
  assert.equal((await sql`SELECT draft->>'regulations' AS regulations FROM workflow_maps WHERE id = ${mapId}`)[0].regulations,
    "Сначала проверить заявку, затем оформить заказ");
  assert.equal((await sql`SELECT draft#>>'{nodes,1,resource,id}' AS linked_id FROM workflow_maps WHERE id = ${mapId}`)[0].linked_id,
    linkedClient.id);
  await page.getByLabel("Комментарий к карте").fill("Уточним порядок проверки на следующей встрече");
  await page.getByRole("button", { name: "Добавить комментарий" }).click();
  await page.getByText("Уточним порядок проверки на следующей встрече").waitFor();
  await page.reload();
  await page.getByText("2 блоков · 1 связей").waitFor();
  assert.equal(await page.getByRole("button", { name: /Событие · 01 Новая заявка/ }).count(), 1);
  assert.equal(await page.getByRole("button", { name: /Карточка CRM · 02 Заказ в CRM/ }).count(), 1);
  await page.screenshot({ path: join(artifacts, "workflow-map-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Workflow must not overflow the mobile viewport");
  await page.screenshot({ path: join(artifacts, "workflow-map-mobile.png"), animations: "disabled", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });

  const secondContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 960 } });
  const secondPage = await secondContext.newPage();
  await secondPage.goto(`${baseUrl}/workflow?map=${mapId}`);
  await secondPage.getByLabel("Название", { exact: true }).fill("Изменение во второй вкладке");
  await secondPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await secondPage.getByRole("status").filter({ hasText: "Карта сохранена" }).waitFor();
  await page.getByLabel("Название", { exact: true }).fill("Устаревшее изменение");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Карту изменили в другой вкладке" }).waitFor();
  assert.equal((await sql`SELECT title FROM workflow_maps WHERE id = ${mapId}`)[0].title, "Изменение во второй вкладке");
  await secondPage.getByRole("button", { name: "Отправить на согласование" }).click();
  await secondPage.getByText("Согласовать должен другой сотрудник", { exact: false }).waitFor();
  const reviewerContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  reviewerPage = await reviewerContext.newPage();
  reviewerPage.on("pageerror", (error) => browserErrors.push(error.message));
  await reviewerPage.goto(`${baseUrl}/login`);
  await reviewerPage.getByPlaceholder("Email или телефон").fill(reviewerEmail);
  await reviewerPage.getByPlaceholder("Пароль").fill(reviewerPassword);
  await reviewerPage.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await reviewerPage.waitForURL((url) => url.pathname === "/");
  await reviewerPage.goto(`${baseUrl}/notifications`);
  await reviewerPage.getByRole("button", { name: /Карта ждёт согласования/ }).click();
  await reviewerPage.waitForURL((url) => url.pathname === "/workflow" && url.searchParams.get("map") === mapId);
  await reviewerPage.getByRole("button", { name: "Согласовать версию" }).click();
  await reviewerPage.getByRole("status").filter({ hasText: "Версия согласована" }).waitFor();
  assert.equal(await reviewerPage.getByRole("button", { name: "Опубликовать версию" }).count(), 0);
  await secondPage.reload();
  await secondPage.getByRole("button", { name: "Опубликовать версию" }).click();
  await secondPage.getByText("Версия 3 опубликована.").waitFor();
  assert.equal((await sql`SELECT published_version FROM workflow_maps WHERE id = ${mapId}`)[0].published_version, 3);
  await secondPage.getByRole("button", { name: "Посмотреть опубликованную версию 3" }).click();
  await secondPage.getByText("Содержимое версии 3").waitFor();
  await secondPage.getByText("Общий регламент: Сначала проверить заявку, затем оформить заказ").waitFor();
  await secondPage.screenshot({ path: join(artifacts, "workflow-published.png"), animations: "disabled" });
  await secondPage.getByLabel("Название", { exact: true }).fill("Следующий черновик");
  await secondPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await secondPage.getByRole("status").filter({ hasText: "Карта сохранена" }).waitFor();
  assert.equal((await sql`SELECT published_version FROM workflow_maps WHERE id = ${mapId}`)[0].published_version, 3);
  assert.equal((await sql`SELECT title FROM workflow_map_revisions WHERE map_id = ${mapId} AND version = 3`)[0].title, "Изменение во второй вкладке");
  await secondPage.getByTestId("workflow-revision-3").getByRole("button", { name: "Сравнить" }).click();
  await secondPage.getByText("Версия 3 ↔ черновик 4").waitFor();
  await secondPage.getByTestId("workflow-revision-2").getByRole("button", { name: "Восстановить" }).click();
  await secondPage.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await secondPage.getByText("Черновик · версия 5", { exact: false }).waitFor();
  assert.equal((await sql`SELECT title, published_version FROM workflow_maps WHERE id = ${mapId}`)[0].title, "Путь заявки");
  assert.equal((await sql`SELECT published_version FROM workflow_maps WHERE id = ${mapId}`)[0].published_version, 3);
  await secondPage.getByRole("button", { name: "В архив" }).click();
  await secondPage.getByRole("button", { name: "Подтвердить архивирование" }).click();
  await secondPage.waitForURL(`${baseUrl}/workflow`);
  assert.equal((await sql`SELECT archived_at IS NOT NULL AS archived FROM workflow_maps WHERE id = ${mapId}`)[0].archived, true);

  await secondPage.getByLabel("Название новой карты").fill("Параллельные правки");
  await secondPage.getByRole("button", { name: "Создать карту" }).click();
  await secondPage.waitForURL((url) => url.pathname === "/workflow" && url.searchParams.get("map") !== null);
  const concurrentMapId = new URL(secondPage.url()).searchParams.get("map");
  await reviewerPage.goto(`${baseUrl}/workflow?map=${concurrentMapId}`);
  await reviewerPage.getByRole("button", { name: "Следить за картой" }).click();
  await reviewerPage.getByRole("button", { name: "Не следить за картой" }).waitFor();
  await reviewerPage.getByLabel("Описание", { exact: true }).fill("Черновик менеджера");
  await secondPage.getByLabel("Описание", { exact: true }).fill("Правка администратора");
  await secondPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await secondPage.getByRole("status").filter({ hasText: "Карта сохранена" }).waitFor();
  await reviewerPage.getByRole("button", { name: "Проверить изменения карты" }).click();
  await reviewerPage.getByRole("alert").filter({ hasText: "доступна версия 2" }).waitFor();
  await reviewerPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await reviewerPage.getByRole("alert").filter({ hasText: "Карту изменил другой сотрудник" }).waitFor();
  reviewerPage.once("dialog", (dialog) => dialog.accept());
  await reviewerPage.getByRole("button", { name: "Загрузить новую версию" }).click();
  await reviewerPage.getByRole("alert").filter({ hasText: "доступна версия 2" }).waitFor({ state: "hidden" });
  await reviewerPage.getByLabel("Описание", { exact: true }).waitFor();
  assert.equal(await reviewerPage.getByLabel("Описание", { exact: true }).inputValue(), "Правка администратора");
  await reviewerPage.getByLabel("Описание", { exact: true }).fill("Правка менеджера");
  await reviewerPage.getByRole("button", { name: "Сохранить", exact: true }).click();
  await reviewerPage.getByRole("status").filter({ hasText: "Карта сохранена" }).waitFor();
  assert.equal((await sql`SELECT version, description FROM workflow_maps WHERE id = ${concurrentMapId}`)[0].version, 3);
  assert.equal((await sql`SELECT description FROM workflow_maps WHERE id = ${concurrentMapId}`)[0].description, "Правка менеджера");
  assert.equal((await sql`SELECT count(*)::integer AS count FROM notifications WHERE source_type = 'workflow'
    AND source_id = ${concurrentMapId} AND recipient_member_id = ${adminMember.id} AND resolved_at IS NULL`)[0].count > 0, true);
  await secondPage.getByRole("button", { name: "Проверить изменения карты" }).click();
  const concurrentAlert = secondPage.getByRole("alert").filter({ hasText: "доступна версия 3" });
  await concurrentAlert.waitFor();
  await concurrentAlert.scrollIntoViewIfNeeded();
  await secondPage.screenshot({ path: join(artifacts, "workflow-concurrent-conflict.png"), animations: "disabled" });
  assert.deepEqual(browserErrors, []);
  console.log("Workflow browser check passed: context, notifications, two-account concurrent edits, review, publication, immutable history, compare, restore and archive.");
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, "workflow-failure.png") }).catch(() => {});
  if (reviewerPage) {
    await reviewerPage.screenshot({ path: join(artifacts, "workflow-reviewer-failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  await sql?.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
  await rm(storageRoot, { recursive: true, force: true });
}
