import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.PERSONAL_NOTES_CHECK_RUNTIME) {
  throw new Error("Run with isolated PostgreSQL, PERSONAL_NOTES_CHECK_RUNTIME and CHROME_PATH.");
}
const baseUrl = "http://127.0.0.1:3131";
const directory = await mkdtemp(join(tmpdir(), "crm-notes-browser-"));
const databaseName = `crm_notes_browser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const accounts = {
  owner: { email: "owner@notes-browser.invalid", password: randomBytes(32).toString("hex") },
  liza: { email: "liza@notes-browser.invalid", password: randomBytes(32).toString("hex") },
};
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Notes owner", AUTH_BOOTSTRAP_ADMIN_EMAIL: accounts.owner.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: accounts.owner.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Notes acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3131" };
let sql; let server; let serverExit; let browser; let created = false;

async function login(page, account) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(account.email);
  await page.getByPlaceholder("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname === "/");
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const [owner] = await sql`SELECT organization_id FROM organization_members WHERE email = ${accounts.owner.email}`;
  const liza = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
    env: { ...environment, AUTH_MEMBER_ORGANIZATION_ID: owner.organization_id, AUTH_MEMBER_NAME: "Лиза QA",
      AUTH_MEMBER_EMAIL: accounts.liza.email, AUTH_MEMBER_PASSWORD: accounts.liza.password, AUTH_MEMBER_ROLE: "crm_coordinator" }, stdio: "inherit" });
  assert.equal(liza.status, 0);
  const [seed] = await sql`SELECT template_kind FROM personal_note_templates templates
    JOIN organization_members members ON members.id = templates.owner_member_id
    WHERE members.email = ${accounts.liza.email}`;
  assert.equal(seed.template_kind, "liza_order");
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${owner.organization_id}, 'Клиент для заметок', 'individual') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address, area_square_meters)
    VALUES (${owner.organization_id}, ${client.id}, 'Озон Истра', 'Склад', 'Московская область, Истра', 24198.87) RETURNING id`;
  await sql`INSERT INTO object_service_profiles (organization_id, object_id, area_square_meters, visits_per_month,
    service_schedule, contract_total_minor) VALUES (${owner.organization_id}, ${object.id}, 24198.87, 2, 'Первая и третья неделя', 1839114)`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${owner.organization_id}, ${object.id}, 'Дезинфекция', 'contract', 'area', 7, 1),
      (${owner.organization_id}, ${object.id}, 'Дератизация', 'contract', 'area', 23, 2)`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organization_id}, ${client.id}, ${object.id}, 'NOTE-001', 'new', 'RUB',
      'Клиент для заметок', 'Озон Истра', 'Московская область, Истра') RETURNING id`;
  await sql`INSERT INTO clients (organization_id, legal_name, updated_at)
    SELECT ${owner.organization_id}, 'Масштаб заметок ' || n, now() - n * interval '1 day' FROM generate_series(1, 67) n`;
  const [lizaMember] = await sql`SELECT id FROM organization_members WHERE email = ${accounts.liza.email}`;
  await sql`INSERT INTO personal_note_templates (owner_organization_id, owner_member_id, name, body)
    SELECT ${owner.organization_id}, ${lizaMember.id}, 'Личный шаблон ' || n, 'Мой текст ' || n FROM generate_series(1, 67) n`;
  const visitStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
  visitStart.setUTCHours(10, 0, 0, 0);
  const visitEnd = new Date(visitStart.getTime() + 2 * 60 * 60 * 1000);
  await sql`INSERT INTO service_visits (organization_id, order_id, object_id, scheduled_start_at, scheduled_end_at,
    status, client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organization_id}, ${order.id}, ${object.id}, ${visitStart}, ${visitEnd}, 'planned',
      'Клиент для заметок', 'Озон Истра', 'Московская область, Истра')`;
  await sql`INSERT INTO tasks (organization_id, title, related_order_id)
    VALUES (${owner.organization_id}, 'Задача этого заказа', ${order.id}),
      (${owner.organization_id}, 'Задача без заказа', NULL)`;

  const runtime = resolve(process.env.PERSONAL_NOTES_CHECK_RUNTIME);
  await cp(resolve(dirname(runtime), "..", "static"), join(dirname(runtime), basename(resolve(dirname(runtime), "..")), "static"), { recursive: true, force: true });
  await cp(resolve("public"), join(dirname(runtime), "public"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); } });
  });
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
  const lizaPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(lizaPage, accounts.liza);
  const panel = lizaPage.getByRole("region", { name: "Личные заметки" });
  await panel.getByRole("button", { name: "По шаблону" }).click();
  await panel.getByRole("textbox", { name: "Поиск шаблона" }).fill("Личный шаблон 67");
  await panel.getByRole("button", { name: "Личный шаблон 67", exact: true }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Личный шаблон 1", exact: true }).count(), 0);
  await panel.getByRole("textbox", { name: "Поиск шаблона" }).fill("нет такого шаблона");
  await panel.getByRole("status").filter({ hasText: "Шаблоны не найдены" }).waitFor();
  await panel.getByRole("textbox", { name: "Поиск шаблона" }).fill("");
  await panel.getByRole("button", { name: "Изменить шаблон Объект и стоимость" }).click();
  const editedBody = "Название объекта: {{object}}\nПлощадь объекта: 150\nНаименование услуг: Дезинфекция\nЦена за кВ.м.: 0,07\nОбщий чек: 1050\nОбслуживание: два раза в месяц";
  await panel.getByRole("textbox", { name: "Текст шаблона" }).fill(editedBody);
  await panel.getByRole("button", { name: "Сохранить шаблон" }).click();
  await panel.getByRole("status").filter({ hasText: "Шаблон обновлён" }).waitFor();
  await panel.getByRole("button", { name: "Объект и стоимость", exact: true }).click();
  assert.equal(await panel.getByRole("textbox", { name: "Площадь объекта" }).inputValue(), "150");
  assert.equal(await panel.getByRole("textbox", { name: "Обслуживание" }).inputValue(), "два раза в месяц");
  assert.equal(await panel.getByRole("textbox", { name: "Услуга 1" }).inputValue(), "Дезинфекция");
  assert.equal(await panel.getByRole("textbox", { name: "Цена за м² для услуги 1" }).inputValue(), "0,07");
  await panel.getByRole("button", { name: "Добавить услугу" }).click();
  await panel.getByRole("textbox", { name: "Услуга 2" }).fill("Дератизация");
  await panel.getByRole("textbox", { name: "Цена за м² для услуги 2" }).fill("0,23");
  await panel.getByRole("button", { name: "Сохранить", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "Заметка сохранена" }).waitFor();
  await lizaPage.reload();
  await panel.getByText("Дератизация — 0,23 ₽/м²").waitFor();
  await panel.getByRole("button", { name: "По шаблону" }).click();
  await panel.getByRole("button", { name: "Объект и стоимость", exact: true }).click();
  await panel.getByText("Сохранить в шаблоны", { exact: true }).click();
  assert.equal(await panel.getByRole("switch", { name: "Сохранить в шаблоны" }).isChecked(), true);
  await panel.getByRole("textbox", { name: "Название шаблона" }).fill("Личное обслуживание");
  await panel.getByRole("button", { name: "Сохранить", exact: true }).click();
  await panel.getByRole("status").filter({ hasText: "Заметка и шаблон сохранены" }).waitFor();
  await lizaPage.reload();
  await panel.getByRole("button", { name: "По шаблону" }).click();
  await panel.getByRole("button", { name: "Личное обслуживание", exact: true }).click();
  assert.equal(await panel.getByRole("textbox", { name: "Услуга 1" }).inputValue(), "Дезинфекция");
  await panel.getByRole("button", { name: "Закрыть редактор" }).click();
  await panel.getByRole("button", { name: "Новая заметка" }).click();
  await panel.getByRole("textbox", { name: "Заголовок (необязательно)" }).fill("Маршрут проверки");
  await panel.getByRole("textbox", { name: "Текст", exact: true }).fill("Заметка связана с заказом");
  // A slow request must keep the editor locked and ignore a second immediate save.
  let releaseSave; let notifySave;
  const saveGate = new Promise((resolveGate) => { releaseSave = resolveGate; });
  const saveStarted = new Promise((resolveStarted) => { notifySave = resolveStarted; });
  let saveRequests = 0;
  await lizaPage.route("**/*", async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      saveRequests += 1; notifySave(); await saveGate;
    }
    await route.continue();
  });
  await panel.getByRole("button", { name: "Сохранить", exact: true }).evaluate((button) => { button.click(); button.click(); });
  await saveStarted;
  assert.equal(await panel.getByRole("button", { name: "Сохранить", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole("textbox", { name: "Текст", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByRole("button", { name: "Закрыть редактор" }).isDisabled(), true);
  assert.equal(saveRequests, 1);
  releaseSave();
  await panel.getByRole("status").filter({ hasText: "Заметка сохранена" }).waitFor();
  await lizaPage.unroute("**/*");
  const [createdNoteCount] = await sql`SELECT count(*) AS count FROM personal_notes
    WHERE owner_member_id = ${lizaMember.id} AND target_kind = 'dashboard' AND title = 'Маршрут проверки'`;
  assert.equal(Number(createdNoteCount.count), 1);
  const dashboardNote = panel.locator("article").filter({ hasText: "Маршрут проверки" });
  await dashboardNote.waitFor();
  let failDestination = true;
  await lizaPage.route("**/*", async (route) => {
    if (failDestination && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      failDestination = false; await route.abort("failed"); return;
    }
    await route.continue();
  });
  await dashboardNote.getByRole("button", { name: "Дублировать" }).click();
  await panel.getByRole("alert").filter({ hasText: "Не удалось загрузить места назначения" }).waitFor();
  await panel.getByRole("button", { name: "Повторить поиск" }).click();
  await panel.getByRole("button", { name: "Главная · здесь", exact: true }).waitFor();
  await lizaPage.unroute("**/*");
  const destinationSearch = panel.getByPlaceholder("Номер заказа или имя клиента");
  await destinationSearch.fill("Масштаб заметок");
  await panel.getByRole("button", { name: "Клиент · Масштаб заметок 1", exact: true }).waitFor();
  const destinationList = panel.locator('[aria-label="Места назначения заметки"]');
  assert.equal(await destinationList.getByRole("button").filter({ hasText: "Клиент · Масштаб заметок" }).count(), 30);
  await panel.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await panel.getByRole("button", { name: "Клиент · Масштаб заметок 60", exact: true }).waitFor();
  await panel.getByRole("button", { name: "Показать ещё", exact: true }).click();
  await panel.getByRole("button", { name: "Клиент · Масштаб заметок 67", exact: true }).waitFor();
  assert.equal(await destinationList.getByRole("button").filter({ hasText: "Клиент · Масштаб заметок" }).count(), 67);
  assert.equal(await panel.getByRole("button", { name: "Показать ещё", exact: true }).count(), 0);
  for (const width of [390, 768, 1440]) {
    await lizaPage.setViewportSize({ width, height: 900 });
    assert.equal(await lizaPage.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const bounds = await destinationList.boundingBox();
    assert(bounds.height <= 241, `Destination list stays bounded at ${width}px`);
    if (process.env.CRM_BROWSER_ARTIFACT_DIR) {
      await mkdir(process.env.CRM_BROWSER_ARTIFACT_DIR, { recursive: true });
      await destinationList.scrollIntoViewIfNeeded();
      await lizaPage.screenshot({ path: join(process.env.CRM_BROWSER_ARTIFACT_DIR, `notes-destinations-${width}.png`) });
    }
  }
  await destinationSearch.fill("не найдено");
  // Results from the previous query disappear immediately; they cannot be selected while searching.
  assert.equal(await panel.getByRole("button", { name: "Клиент · Масштаб заметок 67", exact: true }).count(), 0);
  await panel.getByRole("status").filter({ hasText: "Заказы и клиенты не найдены" }).waitFor();
  await panel.getByRole("button", { name: "Главная · здесь", exact: true }).waitFor();

  await panel.getByPlaceholder("Номер заказа или имя клиента").fill("Клиент для заметок");
  await panel.getByRole("button", { name: "Клиент · Клиент для заметок" }).click();
  await panel.getByRole("status").filter({ hasText: "Копия создана" }).waitFor();
  await dashboardNote.getByRole("button", { name: "Перенести", exact: true }).click();
  await panel.getByPlaceholder("Номер заказа или имя клиента").fill("не найдено");
  await panel.getByRole("status").filter({ hasText: "Заказы и клиенты не найдены. Уточните поиск." }).waitFor();
  assert.equal(await panel.getByRole("button", { name: "Главная · здесь", exact: true }).count(), 0);
  await panel.getByRole("button", { name: "Закрыть выбор" }).click();
  await lizaPage.goto(`${baseUrl}/clients/${client.id}`);
  const clientPanel = lizaPage.getByRole("region", { name: "Личные заметки" });
  const clientNote = clientPanel.locator("article").filter({ hasText: "Маршрут проверки" });
  await clientNote.waitFor();
  await clientNote.getByRole("button", { name: "Перенести" }).click();
  await clientPanel.getByPlaceholder("Номер заказа или имя клиента").fill("NOTE-001");
  await clientPanel.getByRole("button", { name: "Заказ NOTE-001 · Клиент для заметок" }).click();
  await clientPanel.getByRole("status").filter({ hasText: "Заметка перенесена" }).waitFor();
  assert.equal(await clientPanel.locator("article").filter({ hasText: "Маршрут проверки" }).count(), 0);
  await lizaPage.goto(`${baseUrl}/orders/${order.id}`);
  const orderPanel = lizaPage.getByRole("region", { name: "Личные заметки" });
  await orderPanel.locator("article").filter({ hasText: "Маршрут проверки" }).waitFor();
  await orderPanel.getByRole("button", { name: "По шаблону" }).click();
  await orderPanel.getByRole("button", { name: "Объект и стоимость", exact: true }).click();
  assert.equal(await orderPanel.getByRole("textbox", { name: "Название объекта" }).inputValue(), "Озон Истра");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Площадь объекта" }).inputValue(), "24198,87");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Услуга 1" }).inputValue(), "Дезинфекция");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Цена за м² для услуги 1" }).inputValue(), "0,07");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Услуга 2" }).inputValue(), "Дератизация");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Цена за м² для услуги 2" }).inputValue(), "0,23");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Общий чек" }).inputValue(), "18391,14");
  assert.equal(await orderPanel.getByRole("textbox", { name: "Обслуживание" }).inputValue(), "Первая и третья неделя");
  await orderPanel.getByRole("button", { name: "Закрыть редактор" }).click();
  await orderPanel.getByRole("link", { name: "Календарь заказа" }).click();
  await lizaPage.waitForURL((current) => current.pathname === "/calendar" && current.searchParams.get("order") === order.id);
  await lizaPage.getByRole("status").filter({ hasText: "Календарь заказа NOTE-001" }).waitFor();
  await lizaPage.getByRole("link", { name: "Весь календарь" }).click();
  await lizaPage.waitForURL((current) => current.pathname === "/calendar" && !current.searchParams.has("order"));
  await lizaPage.goto(`${baseUrl}/orders/${order.id}`);
  await lizaPage.getByRole("region", { name: "Личные заметки" }).getByRole("link", { name: "Задачи заказа" }).click();
  await lizaPage.waitForURL((current) => current.pathname === "/tasks" && current.searchParams.get("order") === order.id);
  await lizaPage.getByRole("status").filter({ hasText: "Задачи заказа NOTE-001" }).waitFor();
  await lizaPage.getByText("Задача этого заказа").waitFor();
  assert.equal(await lizaPage.getByText("Задача без заказа").count(), 0);
  await lizaPage.getByRole("link", { name: "Все задачи" }).click();
  await lizaPage.waitForURL((current) => current.pathname === "/tasks" && !current.searchParams.has("order"));
  await lizaPage.getByText("Задача без заказа").waitFor();
  await sql`UPDATE personal_notes SET updated_at = now() - interval '3 days'
    WHERE owner_member_id = ${lizaMember.id} AND target_kind = 'dashboard' AND title = 'Маршрут проверки'`;
  await lizaPage.goto(baseUrl);
  await panel.locator("article").filter({ hasText: "Маршрут проверки" }).waitFor();
  for (const width of [390, 768, 1440]) {
    await lizaPage.setViewportSize({ width, height: 900 });
    const horizontalOverflow = await lizaPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(horizontalOverflow, false, `Dashboard must fit ${width}px`);
  }
  const ownerPage = await browser.newPage();
  await login(ownerPage, accounts.owner);
  const ownerPanel = ownerPage.getByRole("region", { name: "Личные заметки" });
  assert.equal(await ownerPanel.getByText("Дератизация — 0,23 ₽/м²").count(), 0);
  await ownerPanel.getByRole("button", { name: "По шаблону" }).click();
  assert.equal(await ownerPanel.getByRole("button", { name: "Объект и стоимость" }).count(), 0);
  assert.equal(await ownerPanel.getByRole("button", { name: "Личное обслуживание" }).count(), 0);
  await ownerPage.goto(`${baseUrl}/orders/${order.id}`);
  assert.equal(await ownerPage.getByRole("region", { name: "Личные заметки" }).getByText("Маршрут проверки").count(), 0);
  console.log("Personal notes UI passed: 67 destination pages, template search, failed lookup retry, stale-result hiding, older saved notes; Liza templates, paired rates, dashboard/client/order transfer, contextual calendar/tasks, privacy and responsive widths.");
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  if (sql) await sql.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
