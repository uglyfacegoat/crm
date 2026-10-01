import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.CONTRACT_PICKER_CHECK_RUNTIME || !process.env.CHROME_PATH) {
  throw new Error("Run with isolated PostgreSQL, CONTRACT_PICKER_CHECK_RUNTIME and CHROME_PATH.");
}
const baseUrl = "http://127.0.0.1:3136";
const directory = await mkdtemp(join(tmpdir(), "crm-contract-picker-browser-"));
const databaseName = `crm_contract_picker_browser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const account = { email: "owner@contract-picker.invalid", password: randomBytes(32).toString("hex") };
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Contract owner", AUTH_BOOTSTRAP_ADMIN_EMAIL: account.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: account.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Contracts browser",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3136" };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let browser; let created = false;
try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 3, onnotice: () => {} });
  const [owner] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${account.email}`;
  await sql`INSERT INTO organization_units (organization_id, unit_kind, name)
    SELECT ${owner.organization_id}, 'city', 'Город ' || lpad(n::text, 2, '0') FROM generate_series(1, 25) n`;
  const [targetCity] = await sql`INSERT INTO organization_units (organization_id, unit_kind, name)
    VALUES (${owner.organization_id}, 'city', 'Янтарный город Ёж') RETURNING id`;
  await sql`INSERT INTO organization_units (organization_id, parent_unit_id, unit_kind, name)
    SELECT ${owner.organization_id}, ${targetCity.id}, 'area', 'Район ' || lpad(n::text, 2, '0') FROM generate_series(1, 25) n`;
  await sql`INSERT INTO organization_units (organization_id, parent_unit_id, unit_kind, name)
    VALUES (${owner.organization_id}, ${targetCity.id}, 'area', 'Янтарный район Ёж')`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${owner.organization_id}, 'Договорный клиент', 'legal_entity') RETURNING id`;
  await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    SELECT ${owner.organization_id}, ${client.id}, 'Объект ' || lpad(n::text, 2, '0'), 'Office', 'Тестовый адрес ' || n
    FROM generate_series(1, 25) n`;
  const [targetObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${owner.organization_id}, ${client.id}, 'Янтарный объект Ёж', 'Office', 'Янтарный адрес') RETURNING id`;
  await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    SELECT ${owner.organization_id}, 'Мастер ' || lpad(n::text, 2, '0'), '+7999' || lpad(n::text, 7, '0'),
      '+7999' || lpad(n::text, 7, '0'), 'Москва', 'Москва' FROM generate_series(1, 25) n`;
  const [targetMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${owner.organization_id}, 'Янтарный мастер Ёж', '+79998888888', '+79998888888', 'Москва', 'Москва') RETURNING id`;
  await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    SELECT ${owner.organization_id}, ${client.id}, ${targetObject.id}, 'А-' || lpad(n::text, 2, '0'),
      'draft', '2026-01-01', '2026-12-31', 30 FROM generate_series(1, 25) n`;
  const [targetContract] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    VALUES (${owner.organization_id}, ${client.id}, ${targetObject.id}, 'Янтарный договор Ёж', 'draft', '2026-01-01', '2026-12-31', 30) RETURNING id`;
  const runtime = resolve(process.env.CONTRACT_PICKER_CHECK_RUNTIME);
  await cp(resolve(dirname(runtime), "../static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
  await cp(resolve("public"), join(dirname(runtime), "public"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); ready(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(account.email);
  await page.getByPlaceholder("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname === "/");
  await page.goto(`${baseUrl}/contracts`);
  await page.getByRole("button", { name: "Новый договор", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Новый договор" });
  await dialog.locator('summary[aria-label="Клиент и объект"]').click();
  await dialog.getByPlaceholder("Клиент, объект или адрес").fill("янтарный");
  await dialog.getByRole("button", { name: /Янтарный объект Ёж/ }).click();
  assert.equal(await dialog.locator('input[name="objectId"]').inputValue(), targetObject.id);
  assert.equal(await dialog.locator('input[name="clientId"]').inputValue(), client.id);
  await dialog.locator('summary[aria-label="Мастер по умолчанию"]').click();
  await dialog.getByPlaceholder("ФИО, телефон или регион").fill("янтарный");
  await dialog.getByRole("button", { name: /Янтарный мастер Ёж/ }).click();
  assert.equal(await dialog.locator('input[name="defaultMasterId"]').inputValue(), targetMaster.id);
  await dialog.locator('input[name="contractNumber"]').fill("БРАУЗЕР-1");
  await dialog.locator('input[data-form-name="startsOn"]').fill("01.10.2026");
  await dialog.locator('input[data-form-name="endsOn"]').fill("01.11.2026");
  await dialog.getByRole("button", { name: "Создать договор" }).click();
  await dialog.waitFor({ state: "hidden" });
  const [contract] = await sql`SELECT contracts.id, rules.default_master_id FROM contracts
    JOIN contract_schedule_rules rules ON rules.organization_id = contracts.organization_id AND rules.contract_id = contracts.id
    WHERE contracts.organization_id = ${owner.organization_id} AND contracts.contract_number = 'БРАУЗЕР-1'`;
  assert.ok(contract);
  assert.equal(contract.default_master_id, targetMaster.id);
  await page.getByRole("link", { name: "БРАУЗЕР-1", exact: true }).waitFor();
  await page.getByRole("button", { name: "Связать договор БРАУЗЕР-1" }).click();
  const relationDialog = page.getByRole("dialog", { name: "Связать договор" });
  await relationDialog.locator('summary[aria-label="Связанный договор"]').click();
  await relationDialog.getByPlaceholder("Номер договора или клиент").fill("янтарный");
  await relationDialog.getByRole("button", { name: /Янтарный договор Ёж/ }).click();
  assert.equal(await relationDialog.locator('input[name="relatedContractId"]').inputValue(), targetContract.id);
  await relationDialog.getByRole("button", { name: "Связать договоры" }).click();
  await relationDialog.waitFor({ state: "hidden" });
  const [relation] = await sql`SELECT contract_a_id, contract_b_id FROM contract_relations
    WHERE organization_id = ${owner.organization_id} AND contract_a_id IN (${contract.id}, ${targetContract.id})
      AND contract_b_id IN (${contract.id}, ${targetContract.id})`;
  assert.ok(relation);
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `horizontal overflow at ${width}px`);
    await page.getByRole("button", { name: "Новый договор", exact: true }).click();
    const resizeDialog = page.getByRole("dialog", { name: "Новый договор" });
    await resizeDialog.locator('summary[aria-label="Клиент и объект"]').click();
    await resizeDialog.getByPlaceholder("Клиент, объект или адрес").fill("янтарный");
    await resizeDialog.getByRole("button", { name: /Янтарный объект Ёж/ }).waitFor();
    await resizeDialog.getByRole("button", { name: "Закрыть окно" }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/companies`);
  await page.locator('summary[aria-label="Город"]').click();
  await page.getByPlaceholder("Найти город").fill("янтарный");
  await page.getByRole("button", { name: "Янтарный город Ёж", exact: true }).click();
  await page.locator('summary[aria-label="Район · необязательно"]').click();
  await page.getByPlaceholder("Найти район").fill("янтарный");
  await page.getByRole("button", { name: "Янтарный район Ёж", exact: true }).click();
  assert.match(await page.locator('summary[aria-label="Район · необязательно"]').innerText(), /Янтарный район Ёж/);
  await page.locator('summary[aria-label="Город"]').click();
  await page.getByPlaceholder("Найти город").fill("Город 01");
  await page.getByRole("button", { name: "Город 01", exact: true }).click();
  assert.equal(await page.locator('summary[aria-label="Район · необязательно"]').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "company picker horizontal overflow at 390px");
  await sql`UPDATE organizations SET organization_kind = 'center' WHERE id = ${owner.organization_id}`;
  const [company] = await sql`INSERT INTO organizations (name, timezone, organization_kind, parent_organization_id)
    VALUES ('Янтарная компания Ёж', 'Europe/Moscow', 'company', ${owner.organization_id}) RETURNING id`;
  const [shadow] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${company.id}, 'Company shadow', ${account.email}, 'admin') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${owner.organization_id}, ${owner.id}, ${company.id}, ${shadow.id})`;
  await page.goto(`${baseUrl}/services`);
  await page.getByRole("button", {name: "Единицы измерения", exact: true}).click();
  await page.getByRole("button", { name: "Добавить единицу", exact: true }).click();
  const unitDialog = page.getByRole("dialog", { name: "Единица измерения" });
  await unitDialog.locator('summary[aria-label="Компания"]').click();
  await unitDialog.getByPlaceholder("Найти компанию").fill("янтарная");
  await unitDialog.getByRole("button", { name: "Янтарная компания Ёж", exact: true }).click();
  await unitDialog.getByPlaceholder("м²").fill("тест.ед.");
  await unitDialog.getByPlaceholder("квадратный метр").fill("Тестовая единица");
  await unitDialog.getByRole("button", { name: "Сохранить" }).click();
  await unitDialog.waitFor({ state: "hidden" });
  const [unit] = await sql`SELECT id FROM catalog_units WHERE organization_id = ${company.id} AND symbol = 'тест.ед.'`;
  assert.ok(unit);
  await page.getByRole("dialog", {name: "Единицы измерения", exact: true}).getByRole("button", {name: "Закрыть окно"}).click();
  await page.getByRole("button", { name: "Добавить услугу" }).click();
  const itemDialog = page.getByRole("dialog", { name: "Новая позиция" });
  await itemDialog.locator('summary[aria-label="Компания *"]').click();
  await itemDialog.getByPlaceholder("Найти компанию").fill("янтарная");
  await itemDialog.getByRole("button", { name: "Янтарная компания Ёж", exact: true }).click();
  assert.equal(await itemDialog.locator('input[name="organizationId"]').inputValue(), company.id);
  await itemDialog.locator('input[name="name"]').fill("Янтарная услуга Ёж");
  await itemDialog.locator('summary[aria-label="Единица *"]').click();
  await itemDialog.getByRole("button", { name: /тест\.ед\./ }).click();
  await itemDialog.locator('input[name="defaultPrice"]').fill("1500");
  await itemDialog.getByRole("button", { name: "Сохранить" }).click();
  await itemDialog.waitFor({ state: "hidden" });
  const [item] = await sql`SELECT id, unit FROM catalog_items WHERE organization_id = ${company.id} AND name = 'Янтарная услуга Ёж'`;
  assert.ok(item);
  assert.equal(item.unit, "тест.ед.");
  await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    SELECT ${company.id}, 'service', 'А-услуга ' || lpad(n::text, 4, '0'), 'усл.', 'fixed', 100
    FROM generate_series(1, 1001) n`;
  await page.goto(`${baseUrl}/services`);
  assert.equal(await page.getByRole('tab', {name: /Условия по объектам/}).count(), 0);
  const companyCatalog = await page.request.get(`${baseUrl}/api/v1/services/options?organizationId=${company.id}&q=Янтарная`);
  assert.equal(companyCatalog.status(), 200);
  assert.equal((await companyCatalog.json()).data.items[0].id, item.id);
  const deniedCatalog = await page.request.get(`${baseUrl}/api/v1/services/options?organizationId=${randomUUID()}&q=Янтарная`);
  assert.equal(deniedCatalog.status(), 404, "A company without a center grant must not expose its catalog");
  console.log("Contract, company and catalog pickers passed: saved IDs, city/area reset, company catalog without object conditions; 390/768/1440px.");
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await once(server, "exit"); }
  if (sql) await sql.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
