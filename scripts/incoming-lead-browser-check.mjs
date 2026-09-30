import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { saveIncomingMail } from "../src/server/mail/ingest.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.INCOMING_LEAD_CHECK_RUNTIME || !process.env.CHROME_PATH) {
  throw new Error("Run with isolated PostgreSQL, INCOMING_LEAD_CHECK_RUNTIME and CHROME_PATH.");
}
const baseUrl = "http://127.0.0.1:3132";
const directory = await mkdtemp(join(tmpdir(), "crm-inbox-browser-"));
const databaseName = `crm_inbox_browser_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const account = { email: "owner@inbox-browser.invalid", password: randomBytes(32).toString("hex") };
const colleagueAccount = { email: "colleague@inbox-browser.invalid", password: randomBytes(32).toString("hex") };
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  CRM_MAIL_OUTBOUND_ENABLED: "true",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Inbox owner", AUTH_BOOTSTRAP_ADMIN_EMAIL: account.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: account.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Inbox acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3132" };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false;

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 3, onnotice: () => {} });
  const [owner] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${account.email}`;
  const colleague = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
    env: { ...environment, AUTH_MEMBER_ORGANIZATION_ID: owner.organization_id, AUTH_MEMBER_NAME: "Inbox colleague",
      AUTH_MEMBER_EMAIL: colleagueAccount.email, AUTH_MEMBER_PASSWORD: colleagueAccount.password, AUTH_MEMBER_ROLE: "crm_coordinator" },
    stdio: "inherit",
  });
  assert.equal(colleague.status, 0);
  const [site] = await sql`INSERT INTO websites (organization_id, name, domain, status)
    VALUES (${owner.organization_id}, 'Проверочный сайт', 'inbox.example.test', 'active') RETURNING id`;
  const [officeMailbox] = await sql`INSERT INTO mail_sources (organization_id, website_id, address, display_name)
    VALUES (${owner.organization_id}, ${site.id}, 'office@inbox.example.test', 'Офис') RETURNING id`;
  const [salesMailbox] = await sql`INSERT INTO mail_sources (organization_id, website_id, address, display_name)
    VALUES (${owner.organization_id}, ${site.id}, 'sales@inbox.example.test', 'Продажи') RETURNING id`;
  await sql`INSERT INTO mail_messages (organization_id, mailbox_address, uid_validity, imap_uid,
      from_address, from_name, subject, body_text, raw_message, received_at, source_id, recipient_address)
    VALUES (${owner.organization_id}, 'office@inbox.example.test', 1, 1,
      'client@example.test', 'Клиент', 'Вопрос об обработке', 'Когда можно приехать?',
      convert_to('Проверочное письмо', 'UTF8'), now(), ${officeMailbox.id}, 'office@inbox.example.test')`;
  await sql`INSERT INTO mail_messages (organization_id, mailbox_address, uid_validity, imap_uid,
      from_address, from_name, subject, body_text, raw_message, received_at, source_id, recipient_address)
    VALUES (${owner.organization_id}, 'sales@inbox.example.test', 1, 1,
      'other@example.test', 'Другой клиент', 'Другое письмо', 'Другой ящик',
      convert_to('Второе проверочное письмо', 'UTF8'), now(), ${salesMailbox.id}, 'sales@inbox.example.test')`;
  await sql`INSERT INTO mail_messages (organization_id, mailbox_address, uid_validity, imap_uid,
      from_address, from_name, subject, body_text, raw_message, received_at, source_id, recipient_address)
    SELECT ${owner.organization_id}, 'office@inbox.example.test', 1, n + 10,
      'history@example.test', 'Архив', CASE WHEN n = 520 THEN 'Письмо из глубины архива' ELSE 'Архивное письмо ' || n END,
      'Старое содержимое ' || n, convert_to('Архив', 'UTF8'), now() - n * interval '1 minute',
      ${officeMailbox.id}, 'office@inbox.example.test' FROM generate_series(1, 520) AS n`;
  await sql`INSERT INTO mail_outbox (organization_id, source_id, sender_member_id, from_address,
      to_address, subject, body_text, status, created_at, sent_at)
    SELECT ${owner.organization_id}, ${salesMailbox.id}, ${owner.id}, 'sales@inbox.example.test',
      'recipient@example.test', CASE WHEN n = 520 THEN 'Старое отправленное письмо' ELSE 'Отправленное письмо ' || n END,
      'История отправки ' || n, 'sent', now() - n * interval '1 minute', now() - n * interval '1 minute'
      FROM generate_series(1, 520) AS n`;
  await sql`INSERT INTO website_leads (organization_id, website_id, external_event_id, received_at,
      contact_name, phone, service_interest, payload_fingerprint, moderation_status)
    SELECT ${owner.organization_id}, ${site.id}, 'event-' || n,
      now() - n * interval '1 minute', CASE WHEN n = 270 THEN 'Очень старая заявка' ELSE 'Клиент ' || n END,
      CASE WHEN n = 270 THEN '+79991234567' ELSE NULL END,
      CASE WHEN n = 270 THEN 'Дезинфекция склада' ELSE 'Обычная услуга' END,
      'fingerprint-' || n, CASE WHEN n = 270 THEN 'reviewing' ELSE 'new' END
    FROM generate_series(1, 270) AS n`;
  const [oldLead] = await sql`SELECT id FROM website_leads WHERE organization_id = ${owner.organization_id} AND external_event_id = 'event-270'`;
  const [other] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Чужой контур', 'Europe/Moscow') RETURNING id`;
  const [otherSite] = await sql`INSERT INTO websites (organization_id, name, domain, status)
    VALUES (${other.id}, 'Чужой сайт', 'other.example.test', 'active') RETURNING id`;
  const [foreignMailbox] = await sql`INSERT INTO mail_sources (organization_id, website_id, address, display_name)
    VALUES (${other.id}, ${otherSite.id}, 'private@other.example.test', 'Чужая почта') RETURNING id`;
  await sql`INSERT INTO mail_messages (organization_id, mailbox_address, uid_validity, imap_uid,
      from_address, subject, body_text, raw_message, received_at, source_id, recipient_address)
    VALUES (${other.id}, 'private@other.example.test', 1, 1, 'secret@example.test',
      'Секретное письмо чужой компании', 'Закрытое содержимое', convert_to('Секрет', 'UTF8'),
      now(), ${foreignMailbox.id}, 'private@other.example.test')`;
  const [privateLead] = await sql`INSERT INTO website_leads (organization_id, website_id, external_event_id, received_at, contact_name, payload_fingerprint)
    VALUES (${other.id}, ${otherSite.id}, 'private', now(), 'Секретная заявка', 'private-fingerprint') RETURNING id`;

  const runtime = resolve(process.env.INCOMING_LEAD_CHECK_RUNTIME);
  await cp(resolve(dirname(runtime), "../static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(account.email);
  await page.getByPlaceholder("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname === "/");
  await page.goto(`${baseUrl}/inbox`);
  const picker = page.getByRole("region", { name: "Выбор входящей заявки" });
  await picker.getByText("Показано 250 из 270").waitFor();
  assert.equal(await page.getByText("Очень старая заявка").count(), 0);
  await picker.locator('summary[aria-label="Обращение"]').click();
  await picker.getByPlaceholder("Имя, телефон, сайт или услуга").fill("Очень старая");
  await picker.getByRole("button", { name: /Очень старая заявка/ }).click();
  await page.waitForURL((current) => current.pathname === "/inbox" && current.searchParams.get("lead") === oldLead.id);
  await page.getByRole("heading", { name: "Очень старая заявка" }).waitFor();
  await page.getByText("Дезинфекция склада", { exact: true }).waitFor();
  const hiddenResponse = await page.request.get(`${baseUrl}/api/v1/inbox/options?status=all&q=${encodeURIComponent("Секретная")}`);
  assert.equal(hiddenResponse.status(), 200);
  assert.equal((await hiddenResponse.json()).data.items.length, 0);

  await page.getByRole("link", { name: "Уточнить и принять" }).click();
  await page.waitForURL((current) => current.pathname === "/quick-order" && current.searchParams.get("sourceLead") === oldLead.id);
  await page.getByRole("heading", { name: "Уточнить и принять заявку" }).waitFor();
  for (let step = 0; step < 3; step++) await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const [accepted] = await sql`SELECT moderation_status FROM website_leads WHERE id = ${oldLead.id}`;
  assert.equal(accepted.moderation_status, "accepted");
  const [order] = await sql`SELECT id, client_name_snapshot, source_lead_id FROM orders WHERE source_lead_id = ${oldLead.id}`;
  assert.ok(order);
  assert.equal(order.client_name_snapshot, "Очень старая заявка");
  assert.equal(order.source_lead_id, oldLead.id);
  assert.equal(new URL(page.url()).pathname, `/orders/${order.id}`);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(baseUrl);
    const orderFlow = page.locator('section[aria-labelledby="dashboard-orders-heading"]');
    assert.equal(await orderFlow.getByRole("link", { name: "Все заказы", exact: true }).count(), 1);
    assert.equal(await orderFlow.locator("header").getByRole("link", { name: "Все заказы", exact: true }).count(), 0);
    await page.goto(`${baseUrl}/orders`);
    assert.equal(await page.getByRole("button", { name: "Новый заказ", exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "Новый заказ" }).count(), 0);
    await page.goto(`${baseUrl}/orders/${order.id}`);
    const documents = page.locator("section").filter({ has: page.getByRole("heading", { name: "Документы", exact: true }) }).first();
    assert.equal(await documents.getByRole("button", { name: "Добавить", exact: true }).count(), 1);
    assert.equal(await documents.getByRole("link", { name: "Все документы", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  }
  await page.goto(`${baseUrl}/quick-order?sourceLead=${oldLead.id}`);
  await page.waitForURL((current) => current.pathname === `/orders/${order.id}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/inbox?lead=${oldLead.id}`);
  await page.getByRole("heading", { name: "Очень старая заявка" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  await page.getByRole("button", { name: "Все обращения" }).click();
  await picker.locator('summary[aria-label="Обращение"]').waitFor();
  await page.goto(`${baseUrl}/quick-order?sourceLead=${privateLead.id}`);
  await page.getByText("Страница не найдена", { exact: true }).waitFor();

  const [raceLead] = await sql`INSERT INTO website_leads (organization_id, website_id, external_event_id, received_at,
      contact_name, service_interest, payload_fingerprint)
    VALUES (${owner.organization_id}, ${site.id}, 'race', now(), 'Конкурентная заявка', 'Обработка помещения', 'race-fingerprint') RETURNING id`;
  const colleaguePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await colleaguePage.goto(`${baseUrl}/login`);
  await colleaguePage.getByPlaceholder("Email или телефон").fill(colleagueAccount.email);
  await colleaguePage.getByPlaceholder("Пароль").fill(colleagueAccount.password);
  await colleaguePage.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await colleaguePage.waitForURL((current) => current.pathname === "/");
  await Promise.all([page.goto(`${baseUrl}/quick-order?sourceLead=${raceLead.id}`), colleaguePage.goto(`${baseUrl}/quick-order?sourceLead=${raceLead.id}`)]);
  await Promise.all([page.getByRole("heading", { name: "Уточнить и принять заявку" }).waitFor(), colleaguePage.getByRole("heading", { name: "Уточнить и принять заявку" }).waitFor()]);
  for (let step = 0; step < 3; step++) {
    if (step === 2) {
      assert.equal(await colleaguePage.getByText("Выплата мастеру", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Выплата мастеру", { exact: true }).count(), 1);
    }
    await Promise.all([page.getByTestId("quick-next").click(), colleaguePage.getByTestId("quick-next").click()]);
  }
  await Promise.all([page.getByTestId("quick-submit").click(), colleaguePage.getByTestId("quick-submit").click()]);
  for (const participant of [page, colleaguePage]) {
    await participant.waitForFunction(() => /^\/orders\/[^/]+$/.test(location.pathname) || Boolean(document.querySelector('[data-testid="quick-order-error"]')), undefined, { timeout: 20_000 });
    const error = await participant.getByTestId("quick-order-error").count()
      ? await participant.getByTestId("quick-order-error").textContent() : null;
    if (error) assert.match(error, /уже обработана|изменилась/);
    else assert.match(new URL(participant.url()).pathname, /^\/orders\/[^/]+$/);
    assert.equal(await participant.getByText("Страница не найдена", { exact: true }).count(), 0);
  }
  const raceOrders = await sql`SELECT id, client_id FROM orders WHERE organization_id = ${owner.organization_id} AND source_lead_id = ${raceLead.id}`;
  assert.equal(raceOrders.length, 1);
  const [raceState] = await sql`SELECT moderation_status, version FROM website_leads WHERE id = ${raceLead.id}`;
  assert.equal(raceState.moderation_status, "accepted");
  assert.equal(raceState.version, 2);
  const [raceClients] = await sql`SELECT count(*)::integer AS count FROM clients WHERE organization_id = ${owner.organization_id} AND legal_name = 'Конкурентная заявка'`;
  assert.equal(raceClients.count, 1);

  await Promise.all([page.goto(`${baseUrl}/quick-order`), colleaguePage.goto(`${baseUrl}/quick-order`)]);
  for (const [participant, customer] of [[page, "Параллельный заказ владельца"], [colleaguePage, "Параллельный заказ координатора"]]) {
    await participant.getByRole("button", { name: "Новый клиент", exact: true }).click();
    await participant.getByTestId("quick-client-name").fill(customer);
  }
  for (let step = 0; step < 3; step++) {
    await Promise.all([page.getByTestId("quick-next").click(), colleaguePage.getByTestId("quick-next").click()]);
  }
  await Promise.all([page.getByTestId("quick-submit").click(), colleaguePage.getByTestId("quick-submit").click()]);
  await Promise.all([page.getByTestId("quick-order-success").waitFor(), colleaguePage.getByTestId("quick-order-success").waitFor()]);
  const parallelOrders = await sql`SELECT orders.id, clients.legal_name FROM orders
    JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
    WHERE orders.organization_id = ${owner.organization_id}
      AND clients.legal_name IN ('Параллельный заказ владельца', 'Параллельный заказ координатора')`;
  assert.deepEqual(new Set(parallelOrders.map((order) => order.legal_name)),
    new Set(["Параллельный заказ владельца", "Параллельный заказ координатора"]));
  assert.equal(parallelOrders.length, 2);

  await page.goto(`${baseUrl}/quick-order`);
  await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
  await page.getByTestId("quick-client-name").fill("Многоконтактный заказ");
  await page.getByTestId("quick-contact-name").fill("Основной Контакт");
  await page.getByTestId("quick-contact-phone").fill("+7 999 000-00-01");
  const clientSection = page.locator("#quick-client-section");
  await clientSection.getByRole("button", { name: "Контакт", exact: true }).click();
  const extraContact = clientSection.getByText("Контакт 2", { exact: true }).locator("xpath=../..");
  await extraContact.getByRole("textbox", { name: "Имя" }).fill("Второй Контакт");
  await extraContact.getByRole("textbox", { name: "Телефон" }).fill("+7 999 000-00-02");
  await extraContact.getByRole("button", { name: "Ещё номер контакта" }).click();
  await extraContact.getByRole("textbox", { name: "Дополнительный номер" }).fill("+7 999 000-00-03");
  await clientSection.getByRole("button", { name: "Номер", exact: true }).click();
  await clientSection.getByRole("textbox", { name: "Номер", exact: true }).fill("+7 999 000-00-04");
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-object-name").fill("Склад приёмки");
  await page.getByTestId("quick-object-address").fill("Москва, Лесная, 10");
  const objectSection = page.locator("#quick-object-section");
  await objectSection.getByRole("button", { name: "Новый объект" }).click();
  const extraObject = objectSection.getByText("Объект 2", { exact: true }).locator("xpath=../..");
  await extraObject.getByRole("textbox", { name: "Название объекта" }).fill("Второй склад");
  await extraObject.getByRole("textbox", { name: "Адрес" }).fill("Москва, Полевая, 12");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Quick order overflows at ${width}px`);
  }
  for (let step = 1; step < 3; step++) await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const multiOrderId = new URL(page.url()).pathname.split("/")[2];
  const [multiOrder] = await sql`SELECT client_id, object_id, client_contact_id, price_pending FROM orders WHERE id = ${multiOrderId} AND organization_id = ${owner.organization_id}`;
  assert.ok(multiOrder);
  assert.equal(multiOrder.price_pending, true);
  const contacts = await sql`SELECT c.id, c.full_name, oc.position FROM order_contacts oc JOIN client_contacts c ON c.organization_id = oc.organization_id AND c.id = oc.contact_id WHERE oc.organization_id = ${owner.organization_id} AND oc.order_id = ${multiOrderId} ORDER BY oc.position`;
  assert.deepEqual(contacts.map((entry) => entry.full_name), ["Основной Контакт", "Второй Контакт"]);
  const objects = await sql`SELECT o.name, oo.position FROM order_objects oo JOIN client_objects o ON o.organization_id = oo.organization_id AND o.id = oo.object_id WHERE oo.organization_id = ${owner.organization_id} AND oo.order_id = ${multiOrderId} ORDER BY oo.position`;
  assert.deepEqual(objects.map((entry) => entry.name), ["Склад приёмки", "Второй склад"]);
  const phones = await sql`SELECT normalized_phone, contact_id FROM client_phone_numbers WHERE organization_id = ${owner.organization_id} AND client_id = ${multiOrder.client_id} ORDER BY normalized_phone`;
  assert.deepEqual(phones.map((entry) => entry.normalized_phone), ["+79990000003", "+79990000004"]);
  assert.equal(phones[0].contact_id, contacts[1].id);

  const [catalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${owner.organization_id}, 'service', 'Обработка по площади', 'м²', 'fixed', 100) RETURNING id`;
  await sql`INSERT INTO object_service_profiles (organization_id, object_id, area_square_meters)
    VALUES (${owner.organization_id}, ${multiOrder.object_id}, 125.50)`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${owner.organization_id}, ${multiOrder.object_id}, ${catalog.id}, 'Обработка склада по договору', 'contract', 'area', 75, 1)`;
  await page.goto(`${baseUrl}/quick-order`);
  const existingClientSection = page.locator("#quick-client-section");
  await existingClientSection.getByRole("button", { name: "Из CRM" }).click();
  await existingClientSection.getByRole("textbox", { name: "Поиск клиента" }).fill("Многоконтактный заказ");
  await existingClientSection.getByRole("button", { name: "Многоконтактный заказ", exact: true }).click();
  await page.getByTestId("quick-next").click();
  const contractObjectSection = page.locator("#quick-object-section");
  await contractObjectSection.locator('summary[aria-label="Объект"]').click();
  await contractObjectSection.getByRole("button", { name: /Склад приёмки/ }).click();
  await contractObjectSection.getByRole("button", { name: "Подставить услуги и цены по договору" }).waitFor();
  await contractObjectSection.getByRole("button", { name: "Подставить услуги и цены по договору" }).click();
  await page.getByTestId("quick-next").click();
  const workSection = page.locator("#quick-work-section");
  assert.equal(await workSection.getByTestId("quick-service-name").inputValue(), "Обработка склада по договору");
  await workSection.locator('summary[aria-label="Из перечня товаров и услуг"]').click();
  await workSection.getByPlaceholder("Название услуги или товара").fill("Обработка по площади");
  await workSection.getByRole("button", { name: /Обработка склада по договору.*Каталог: Обработка по площади/ }).waitFor();
  await workSection.getByPlaceholder("Название услуги или товара").fill("Обработка склада по договору");
  await workSection.getByRole("button", { name: /Обработка склада по договору.*Каталог: Обработка по площади/ }).click();
  assert.equal(await workSection.getByTestId("quick-service-name").inputValue(), "Обработка склада по договору");
  assert.equal(await workSection.getByRole("textbox", { name: "Количество" }).inputValue(), "125.50");
  assert.equal(await workSection.getByTestId("quick-unit-price").inputValue(), "0.75");
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const contractOrderId = new URL(page.url()).pathname.split("/")[2];
  const [contractOrder] = await sql`SELECT object_id, agreed_total_minor, price_pending, created_by FROM orders WHERE organization_id = ${owner.organization_id} AND id = ${contractOrderId}`;
  assert.equal(contractOrder.object_id, multiOrder.object_id);
  assert.equal(Number(contractOrder.agreed_total_minor), 9413);
  assert.equal(contractOrder.price_pending, false);
  const [contractLine] = await sql`SELECT catalog_item_id, service_name_snapshot, unit_snapshot, unit_price_minor, quantity FROM order_services WHERE organization_id = ${owner.organization_id} AND order_id = ${contractOrderId}`;
  assert.equal(contractLine.catalog_item_id, catalog.id);
  assert.equal(contractLine.service_name_snapshot, "Обработка склада по договору");
  assert.equal(contractLine.unit_snapshot, "м²");
  assert.equal(Number(contractLine.unit_price_minor), 75);
  assert.equal(Number(contractLine.quantity), 125.5);
  await sql`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, created_by)
    VALUES (${owner.organization_id}, ${contractOrderId}, 'Топливо', 7000, '2026-09-30', ${contractOrder.created_by}),
      (${owner.organization_id}, ${contractOrderId}, 'Материалы', 12000, '2026-09-30', ${contractOrder.created_by})`;
  const [payoutMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${owner.organization_id}, 'Проверочный мастер выплат', '+70000000044', '+70000000044', 'Москва', 'Москва') RETURNING id`;
  await sql`UPDATE orders SET assigned_master_id = ${payoutMaster.id}, master_name_snapshot = 'Проверочный мастер выплат',
    master_phone_snapshot = '+70000000044', master_payment_snapshot_minor = 456700 WHERE id = ${contractOrderId}`;
  await colleaguePage.setViewportSize({ width: 390, height: 844 });
  await colleaguePage.goto(`${baseUrl}/orders/${contractOrderId}`);
  await colleaguePage.getByRole("button", { name: "Копия", exact: true }).waitFor();
  assert.equal(await colleaguePage.getByRole("button", { name: "Расход", exact: true }).count(), 0);
  assert.equal(await colleaguePage.getByText("Прямые расходы").count(), 0);
  assert.equal((await colleaguePage.content()).includes("Топливо"), false, "The coordinator must not receive expense details in the page payload");
  assert.equal((await colleaguePage.content()).includes("456700"), false, "The coordinator must not receive the master payout in the page payload");
  await colleaguePage.getByRole("button", { name: "Изменить", exact: true }).click();
  const coordinatorEditDialog = colleaguePage.getByRole("dialog", { name: "Редактировать заказ" });
  assert.equal(await coordinatorEditDialog.getByText("Выплата мастеру, ₽").count(), 0);
  assert.equal(await coordinatorEditDialog.locator('input[name="masterPayment"]').inputValue(), "preserve");
  await coordinatorEditDialog.getByRole("button", { name: "На согласовании" }).click();
  await coordinatorEditDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await coordinatorEditDialog.waitFor({ state: "hidden" });
  const [coordinatorEditedOrder] = await sql`SELECT status, master_payment_snapshot_minor FROM orders WHERE id = ${contractOrderId}`;
  assert.equal(coordinatorEditedOrder.status, "approval");
  assert.equal(Number(coordinatorEditedOrder.master_payment_snapshot_minor), 456700);
  await colleaguePage.getByRole("button", { name: "Копия", exact: true }).click();
  const coordinatorCopyDialog = colleaguePage.getByRole("dialog", { name: /Копия заказа/ });
  assert.equal(await coordinatorCopyDialog.getByText("Прямые расходы").count(), 0);
  assert.equal(await coordinatorCopyDialog.getByText("Расходы этой копии").count(), 0);
  assert.equal(await coordinatorCopyDialog.getByText("Мастер и выплата").count(), 0);
  assert.equal(await coordinatorCopyDialog.getByText("Выплата мастеру, ₽").count(), 0);
  await coordinatorCopyDialog.locator("label").filter({ hasText: "Проверочный мастер выплат" }).last().click();
  assert.equal(await coordinatorCopyDialog.locator('input[name="copyMaster"]').inputValue(), "true");
  const coordinatorCopyDate = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await coordinatorCopyDialog.locator('input[aria-label="Дата в формате ДД.ММ.ГГГГ"]').fill(`${coordinatorCopyDate.slice(8, 10)}.${coordinatorCopyDate.slice(5, 7)}.${coordinatorCopyDate.slice(0, 4)}`);
  await coordinatorCopyDialog.getByRole("button", { name: "Создать копию" }).click();
  await colleaguePage.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname) && current.pathname !== `/orders/${contractOrderId}`);
  const coordinatorCopyId = new URL(colleaguePage.url()).pathname.split("/")[2];
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_expenses WHERE order_id = ${coordinatorCopyId}`)[0].count, 0);
  const [coordinatorCopiedOrder] = await sql`SELECT assigned_master_id, master_payment_snapshot_minor FROM orders WHERE id = ${coordinatorCopyId}`;
  assert.equal(coordinatorCopiedOrder.assigned_master_id, payoutMaster.id);
  assert.equal(coordinatorCopiedOrder.master_payment_snapshot_minor, null);
  await colleaguePage.close();
  await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    SELECT ${owner.organization_id}, 'service', 'А-услуга ' || lpad(n::text, 4, '0'), 'усл.', 'fixed', 100
    FROM generate_series(1, 1001) n`;
  const [remoteCatalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${owner.organization_id}, 'service', 'Янтарная услуга Ёж', 'усл.', 'fixed', 250) RETURNING id`;
  const [alternateMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${owner.organization_id}, 'Другой мастер серии', '+70000000045', '+70000000045', 'Москва', 'Центр') RETURNING id`;
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Копия", exact: true }).click();
  const copyDialog = page.getByRole("dialog", { name: /Копия заказа/ });
  await copyDialog.locator("label").filter({ hasText: "Топливо" }).last().click();
  assert.deepEqual(JSON.parse(await copyDialog.locator('input[name="expenseIds"]').inputValue()).length, 1);
  await copyDialog.getByRole("button", { name: "Выбрать даты" }).click();
  await copyDialog.getByRole("button", { name: "Следующий месяц" }).click();
  const calendar = copyDialog.locator('button[aria-label="Следующий месяц"]').locator("xpath=../..");
  for (let date = 0; date < 5; date++) await calendar.locator('button[aria-pressed="false"]').first().click();
  const copyDates = JSON.parse(await copyDialog.locator('input[name="copyDates"]').inputValue());
  assert.equal(copyDates.length, 5);
  const dateLabel = (date) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  await copyDialog.locator('summary[aria-label="Настроить дату"]').click();
  await copyDialog.getByRole("button", { name: dateLabel(copyDates[0]) }).click();
  await copyDialog.getByRole("button", { name: "Точное время" }).click();
  await copyDialog.locator('[data-form-name="overrideStartTime"]').fill("09:15");
  await copyDialog.locator('summary[aria-label="Настроить дату"]').click();
  await copyDialog.getByRole("button", { name: dateLabel(copyDates[1]) }).click();
  await copyDialog.getByRole("button", { name: "Интервал", exact: true }).click();
  await copyDialog.locator('[data-form-name="overrideStartTime"]').fill("23:30");
  await copyDialog.locator('[data-form-name="overrideEndTime"]').fill("00:30");
  await copyDialog.locator('summary[aria-label="Настроить дату"]').click();
  await copyDialog.getByRole("button", { name: dateLabel(copyDates[0]) }).click();
  assert.equal(await copyDialog.locator('[data-form-name="overrideStartTime"]').inputValue(), "09:15");
  assert.equal(await copyDialog.locator('[data-form-name="overrideEndTime"]').count(), 0);
  await copyDialog.locator('summary[aria-label="Настроить дату"]').click();
  await copyDialog.getByRole("button", { name: dateLabel(copyDates[1]) }).click();
  assert.equal(await copyDialog.locator('[data-form-name="overrideStartTime"]').inputValue(), "23:30");
  assert.equal(await copyDialog.locator('[data-form-name="overrideEndTime"]').inputValue(), "00:30");
  await copyDialog.locator("label").filter({ hasText: "Топливо" }).first().click();
  await copyDialog.locator("label").filter({ hasText: "Материалы" }).first().click();
  await copyDialog.getByPlaceholder("Условия только для этой даты").fill("Особая заметка второй даты");
  await copyDialog.getByRole("button", { name: "+ Добавить" }).click();
  await copyDialog.locator('summary[aria-label="Из перечня товаров и услуг"]').click();
  await copyDialog.getByPlaceholder("Название услуги или товара").fill("Обработка по площади");
  await copyDialog.getByRole("button", { name: /Обработка по площади/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await copyDialog.getByRole("button", { name: "+ Добавить" }).click();
  await copyDialog.locator('summary[aria-label="Из перечня товаров и услуг"]').last().click();
  await copyDialog.getByPlaceholder("Название услуги или товара").last().fill("Янтарная услуга Ёж");
  await copyDialog.getByRole("button", { name: /Янтарная услуга Ёж/ }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Copy dialog overflows at 390px");
  const selectCopyDate = async (index) => {
    await copyDialog.locator('summary[aria-label="Настроить дату"]').click();
    await copyDialog.getByRole("button", { name: dateLabel(copyDates[index]) }).click();
  };
  await selectCopyDate(2);
  await copyDialog.locator('summary[aria-label="Мастер на эту дату"]').click();
  await copyDialog.getByRole("button", { name: /Другой мастер серии/ }).click();
  await copyDialog.getByLabel("Выплата мастеру, ₽", { exact: true }).fill("1234,50");
  await copyDialog.getByRole("button", { name: "Точное время" }).click();
  await copyDialog.locator('[data-form-name="overrideStartTime"]').fill("12:45");
  await copyDialog.getByPlaceholder("Условия только для этой даты").fill("Условия третьей даты");
  await copyDialog.getByRole("button", { name: "+ Добавить" }).click();
  await copyDialog.locator('summary[aria-label="Из перечня товаров и услуг"]').click();
  await copyDialog.getByPlaceholder("Название услуги или товара").fill("Янтарная услуга Ёж");
  await copyDialog.getByRole("button", { name: /Янтарная услуга Ёж/ }).click();
  await copyDialog.getByLabel("Количество", { exact: true }).fill("3");
  await selectCopyDate(3);
  await copyDialog.locator('summary[aria-label="Мастер на эту дату"]').click();
  await copyDialog.getByRole("button", { name: "Без мастера", exact: true }).click();
  await copyDialog.getByRole("button", { name: "Интервал", exact: true }).click();
  await copyDialog.locator('[data-form-name="overrideStartTime"]').fill("10:00");
  await copyDialog.locator('[data-form-name="overrideEndTime"]').fill("11:30");
  await copyDialog.locator("label").filter({ hasText: "Топливо" }).first().click();
  await copyDialog.getByPlaceholder("Условия только для этой даты").fill("");
  await selectCopyDate(4);
  assert.equal(await copyDialog.getByPlaceholder("Условия только для этой даты").inputValue(), "");
  assert.equal(await copyDialog.locator('[data-form-name="overrideStartTime"]').count(), 0);
  assert.equal(await copyDialog.getByLabel("Количество", { exact: true }).count(), 0);
  await selectCopyDate(2);
  assert.equal(await copyDialog.getByLabel("Количество", { exact: true }).inputValue(), "3");
  assert.equal(await copyDialog.locator('[data-form-name="overrideStartTime"]').inputValue(), "12:45");
  assert.equal(await copyDialog.getByPlaceholder("Условия только для этой даты").inputValue(), "Условия третьей даты");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Five-date dialog overflow at ${width}px`);
  }
  await copyDialog.getByRole("button", { name: "Создать 5 заказов" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname) && current.pathname !== `/orders/${contractOrderId}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  const copies = await sql`SELECT copied.id, copied.notes, copied.agreed_total_minor, copied.assigned_master_id, copied.master_payment_snapshot_minor, audit.changes->>'copyDate' AS copy_date
    FROM audit_events audit JOIN orders copied ON copied.organization_id = audit.organization_id AND copied.id = audit.entity_id
    WHERE audit.organization_id = ${owner.organization_id} AND audit.action = 'order.copy'
      AND audit.changes->>'sourceOrderId' = ${contractOrderId} AND audit.changes->>'seriesSize' = '5'
    ORDER BY audit.changes->>'copyDate'`;
  assert.deepEqual(copies.map((copy) => copy.copy_date), copyDates);
  assert.equal(copies[0].notes, null);
  assert.equal(copies[1].notes, "Особая заметка второй даты");
  assert.equal(Number(copies[0].agreed_total_minor), 9413);
  assert.equal(Number(copies[1].agreed_total_minor), 19076);
  assert.deepEqual(copies.slice(2).map(copy => copy.notes), ["Условия третьей даты", null, null]);
  assert.deepEqual(copies.slice(2).map(copy => Number(copy.agreed_total_minor)), [10163, 9413, 9413]);
  assert.equal(copies[2].assigned_master_id, alternateMaster.id);
  assert.equal(Number(copies[2].master_payment_snapshot_minor), 123450);
  assert.equal(copies[3].assigned_master_id, null);
  assert.equal(copies[3].master_payment_snapshot_minor, null);
  const copyExpenses = await sql`SELECT order_id, category, amount_minor, occurred_on::text AS occurred_on FROM order_expenses
    WHERE organization_id = ${owner.organization_id} AND order_id IN ${sql(copies.map(copy => copy.id))} ORDER BY order_id`;
  assert.deepEqual(copyExpenses.map((expense) => [expense.order_id, expense.category, Number(expense.amount_minor), expense.occurred_on]).sort(), [
    [copies[0].id, 'Топливо', 7000, copyDates[0]],
    [copies[1].id, 'Материалы', 12000, copyDates[1]],
    [copies[2].id, 'Топливо', 7000, copyDates[2]],
    [copies[4].id, 'Топливо', 7000, copyDates[4]],
  ].sort());
  const [copyVisit] = await sql`SELECT arrival_mode, (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::time::text AS local_time
    FROM service_visits WHERE organization_id = ${owner.organization_id} AND order_id = ${copies[0].id}`;
  assert.equal(copyVisit.arrival_mode, "fixed");
  assert.equal(copyVisit.local_time, "09:15:00");
  const [secondCopyVisit] = await sql`SELECT arrival_mode, (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::time::text AS local_time,
    (scheduled_end_at AT TIME ZONE 'Europe/Moscow')::time::text AS end_time, extract(epoch from scheduled_end_at - scheduled_start_at)::integer AS seconds
    FROM service_visits WHERE organization_id = ${owner.organization_id} AND order_id = ${copies[1].id}`;
  assert.equal(secondCopyVisit.arrival_mode, "window");
  assert.equal(secondCopyVisit.local_time, "23:30:00");
  assert.equal(secondCopyVisit.end_time, "00:30:00");
  assert.equal(secondCopyVisit.seconds, 3600);
  const [secondCopyServices] = await sql`SELECT count(*)::integer AS count FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${copies[1].id}`;
  assert.equal(secondCopyServices.count, 3);
  const [remoteCopyLine] = await sql`SELECT catalog_item_id, unit_price_minor, line_total_minor FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${copies[1].id} AND catalog_item_id = ${remoteCatalog.id}`;
  assert.equal(remoteCopyLine.catalog_item_id, remoteCatalog.id);
  assert.equal(Number(remoteCopyLine.unit_price_minor), 250);
  assert.equal(Number(remoteCopyLine.line_total_minor), 250);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${copies[0].id} AND catalog_item_id = ${remoteCatalog.id}`)[0].count, 0);
  const remainingVisits = await sql`SELECT order_id, assigned_master_id, arrival_mode,
    (scheduled_start_at AT TIME ZONE 'Europe/Moscow')::time::text AS local_time,
    extract(epoch from scheduled_end_at - scheduled_start_at)::integer AS seconds
    FROM service_visits WHERE order_id IN ${sql(copies.slice(2).map(copy => copy.id))}`;
  assert.equal(remainingVisits.length, 2, "Fifth date inherits no visit; no phantom visit is created");
  const thirdVisit = remainingVisits.find(visit => visit.order_id === copies[2].id);
  const fourthVisit = remainingVisits.find(visit => visit.order_id === copies[3].id);
  assert.equal(thirdVisit.assigned_master_id, alternateMaster.id);
  assert.equal(thirdVisit.arrival_mode, "fixed");
  assert.equal(thirdVisit.local_time, "12:45:00");
  assert.equal(fourthVisit.assigned_master_id, null);
  assert.equal(fourthVisit.arrival_mode, "window");
  assert.equal(fourthVisit.seconds, 5400);
  const extraQuantities = await sql`SELECT order_id, quantity, line_total_minor FROM order_services
    WHERE order_id IN ${sql(copies.map(copy => copy.id))} AND catalog_item_id = ${remoteCatalog.id}`;
  assert.deepEqual(extraQuantities.map(line => [line.order_id, Number(line.quantity), Number(line.line_total_minor)]).sort(), [
    [copies[1].id, 1, 250], [copies[2].id, 3, 750],
  ].sort());
  await page.goto(`${baseUrl}/orders/${contractOrderId}`);
  await page.getByRole("button", { name: "Копия", exact: true }).click();
  const repeatDialog = page.getByRole("dialog", { name: /Копия заказа/ });
  await repeatDialog.getByRole("button", { name: "По интервалу" }).click();
  const repeatStart = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const repeatEnd = new Date(Date.parse(`${repeatStart}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10);
  const displayDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  await repeatDialog.locator('input[aria-label="Дата в формате ДД.ММ.ГГГГ"]').nth(0).fill(displayDate(repeatStart));
  await repeatDialog.locator('input[aria-label="Дата в формате ДД.ММ.ГГГГ"]').nth(1).fill(displayDate(repeatEnd));
  await repeatDialog.locator('summary[aria-label="Повторять"]').click();
  await repeatDialog.getByRole("button", { name: "Каждые N недель" }).click();
  const repeatDates = JSON.parse(await repeatDialog.locator('input[name="copyDates"]').inputValue());
  assert.equal(repeatDates.length, 3);
  await repeatDialog.locator('summary[aria-label="Настроить дату"]').click();
  await repeatDialog.getByRole("button", { name: dateLabel(repeatDates[1]) }).click();
  await repeatDialog.getByPlaceholder("Условия только для этой даты").fill("Примечание только второй недели");
  await repeatDialog.getByRole("button", { name: "Создать 3 заказов" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname) && current.pathname !== `/orders/${contractOrderId}`);
  const repeatedCopies = await sql`SELECT copied.notes, audit.changes->>'copyDate' AS copy_date
    FROM audit_events audit JOIN orders copied ON copied.organization_id = audit.organization_id AND copied.id = audit.entity_id
    WHERE audit.organization_id = ${owner.organization_id} AND audit.action = 'order.copy'
      AND audit.changes->>'sourceOrderId' = ${contractOrderId} AND audit.changes->>'seriesSize' = '3'
      AND audit.changes->>'copyDate' >= ${repeatStart} AND audit.changes->>'copyDate' <= ${repeatEnd}
    ORDER BY audit.changes->>'copyDate'`;
  assert.deepEqual(repeatedCopies.map((copy) => copy.copy_date), repeatDates);
  assert.deepEqual(repeatedCopies.map((copy) => copy.notes), [null, "Примечание только второй недели", null]);
  const [variableCatalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode)
    VALUES (${owner.organization_id}, 'service', 'ТЕСТ · Цена уточняется', 'усл.', 'variable') RETURNING id`;
  await page.goto(`${baseUrl}/quick-order`);
  const pendingClientSection = page.locator("#quick-client-section");
  await pendingClientSection.getByRole("button", { name: "Из CRM" }).click();
  await pendingClientSection.getByRole("textbox", { name: "Поиск клиента" }).fill("Многоконтактный заказ");
  await pendingClientSection.getByRole("button", { name: "Многоконтактный заказ", exact: true }).click();
  await page.getByTestId("quick-next").click();
  const pendingObjectSection = page.locator("#quick-object-section");
  await pendingObjectSection.locator('summary[aria-label="Объект"]').click();
  await pendingObjectSection.getByRole("button", { name: /Второй склад/ }).click();
  await page.getByTestId("quick-next").click();
  const pendingWorkSection = page.locator("#quick-work-section");
  await pendingWorkSection.locator('summary[aria-label="Из перечня товаров и услуг"]').click();
  await pendingWorkSection.getByPlaceholder("Название услуги или товара").fill("ТЕСТ · Цена уточняется");
  await pendingWorkSection.getByRole("button", { name: /ТЕСТ · Цена уточняется/ }).click();
  assert.equal(await pendingWorkSection.getByTestId("quick-unit-price").inputValue(), "");
  await pendingWorkSection.getByText("Цена уточняется", { exact: true }).waitFor();
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const pendingOrderId = new URL(page.url()).pathname.split("/")[2];
  const [pendingOrder] = await sql`SELECT price_pending, agreed_total_minor FROM orders WHERE organization_id = ${owner.organization_id} AND id = ${pendingOrderId}`;
  const [pendingLine] = await sql`SELECT catalog_item_id, price_pending, line_total_minor FROM order_services WHERE organization_id = ${owner.organization_id} AND order_id = ${pendingOrderId}`;
  assert.equal(pendingOrder.price_pending, true);
  assert.equal(Number(pendingOrder.agreed_total_minor), 0);
  assert.equal(pendingLine.catalog_item_id, variableCatalog.id);
  assert.equal(pendingLine.price_pending, true);
  assert.equal(Number(pendingLine.line_total_minor), 0);
  const [secondContractCatalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode, default_price_minor)
    VALUES (${owner.organization_id}, 'service', 'Контроль склада', 'м²', 'fixed', 200) RETURNING id`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, catalog_item_id, name, line_kind, billing_basis, unit_price_minor, position)
    VALUES (${owner.organization_id}, ${multiOrder.object_id}, ${secondContractCatalog.id}, 'Контроль по договору', 'contract', 'area', 50, 2)`;
  await page.goto(`${baseUrl}/quick-order`);
  const twoRateClientSection = page.locator("#quick-client-section");
  await twoRateClientSection.getByRole("button", { name: "Из CRM" }).click();
  await twoRateClientSection.getByRole("textbox", { name: "Поиск клиента" }).fill("Многоконтактный заказ");
  await twoRateClientSection.getByRole("button", { name: "Многоконтактный заказ", exact: true }).click();
  await page.getByTestId("quick-next").click();
  const twoRateObjectSection = page.locator("#quick-object-section");
  await twoRateObjectSection.locator('summary[aria-label="Объект"]').click();
  await twoRateObjectSection.getByRole("button", { name: /Склад приёмки/ }).click();
  await twoRateObjectSection.getByRole("button", { name: "Подставить услуги и цены по договору" }).click();
  await page.getByTestId("quick-next").click();
  const twoRateWorkSection = page.locator("#quick-work-section");
  assert.equal(await twoRateWorkSection.getByTestId("quick-service-name").inputValue(), "Обработка склада по договору");
  assert.equal(await twoRateWorkSection.getByRole("textbox", { name: "Название позиции 2" }).inputValue(), "Контроль по договору");
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const twoRateOrderId = new URL(page.url()).pathname.split("/")[2];
  const [twoRateOrder] = await sql`SELECT agreed_total_minor, price_pending FROM orders WHERE organization_id = ${owner.organization_id} AND id = ${twoRateOrderId}`;
  const twoRateLines = await sql`SELECT catalog_item_id, service_name_snapshot, unit_price_minor, line_total_minor FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${twoRateOrderId} ORDER BY position`;
  assert.equal(twoRateOrder.price_pending, false);
  assert.equal(Number(twoRateOrder.agreed_total_minor), 15688);
  assert.deepEqual(twoRateLines.map((line) => line.catalog_item_id), [catalog.id, secondContractCatalog.id]);
  assert.deepEqual(twoRateLines.map((line) => Number(line.line_total_minor)), [9413, 6275]);
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const editContractDialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  const editSecondPicker = editContractDialog.locator('summary[aria-label="Из перечня товаров и услуг"]').nth(1).locator("xpath=..");
  await editSecondPicker.locator("summary").click();
  await editSecondPicker.getByPlaceholder("Название услуги или товара").fill("Контроль по договору");
  await editSecondPicker.getByRole("button", { name: /Контроль по договору.*Каталог: Контроль склада/ }).click();
  await editContractDialog.getByLabel("Количество услуги 2").fill("100");
  await editContractDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await editContractDialog.waitFor({ state: "hidden" });
  const [editedContractOrder] = await sql`SELECT agreed_total_minor FROM orders WHERE organization_id = ${owner.organization_id} AND id = ${twoRateOrderId}`;
  const [editedSecondLine] = await sql`SELECT catalog_item_id, service_name_snapshot, line_total_minor FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${twoRateOrderId} AND position = 2`;
  assert.equal(Number(editedContractOrder.agreed_total_minor), 14413);
  assert.equal(editedSecondLine.catalog_item_id, secondContractCatalog.id);
  assert.equal(editedSecondLine.service_name_snapshot, "Контроль по договору");
  assert.equal(Number(editedSecondLine.line_total_minor), 5000);
  await page.goto(`${baseUrl}/mail`);
  const firstMailPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=inbox&source=${officeMailbox.id}&page=0`);
  assert.equal(firstMailPage.status(), 200);
  assert.equal((await firstMailPage.json()).data.total, 521);
  const deepMailPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=inbox&source=${officeMailbox.id}&page=17`);
  assert.equal(deepMailPage.status(), 200);
  assert.ok((await deepMailPage.json()).data.messages.some((item) => item.subject === "Письмо из глубины архива"));
  const wrongMailboxPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=inbox&source=${salesMailbox.id}&q=${encodeURIComponent("Письмо из глубины архива")}`);
  assert.equal((await wrongMailboxPage.json()).data.total, 0);
  const foreignMailboxPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=inbox&source=${foreignMailbox.id}`);
  assert.equal(foreignMailboxPage.status(), 200);
  assert.equal((await foreignMailboxPage.json()).data.total, 0);
  const foreignMailSearch = await page.request.get(`${baseUrl}/api/v1/mail/messages?q=${encodeURIComponent("Секретное письмо чужой компании")}`);
  assert.equal((await foreignMailSearch.json()).data.total, 0);
  const invalidMailboxPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?source=bad-id`);
  assert.equal(invalidMailboxPage.status(), 400);
  const oldSentPage = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=sent&source=${salesMailbox.id}&page=17`);
  assert.equal(oldSentPage.status(), 200);
  assert.ok((await oldSentPage.json()).data.sent.some((item) => item.subject === "Старое отправленное письмо"));
  const oldSentSearch = await page.request.get(`${baseUrl}/api/v1/mail/messages?folder=sent&source=${salesMailbox.id}&q=${encodeURIComponent("Старое отправленное письмо")}`);
  assert.equal((await oldSentSearch.json()).data.total, 1);
  await page.locator('summary[aria-label="Почтовый ящик"]').click();
  await page.getByPlaceholder("Адрес или компания").fill("office@");
  await page.getByRole("button", { name: /office@inbox\.example\.test/ }).click();
  await page.getByText("Вопрос об обработке").waitFor();
  await page.getByText("Другое письмо").waitFor({ state: "hidden" });
  await page.getByRole("searchbox", { name: "Найти письмо" }).fill("Письмо из глубины архива");
  await page.getByText("Письмо из глубины архива").waitFor();
  await page.getByText("Письмо из глубины архива").click();
  await page.getByRole("heading", { name: "Письмо из глубины архива" }).waitFor();
  await page.getByRole("searchbox", { name: "Найти письмо" }).fill("");
  await page.getByText("Вопрос об обработке").waitFor();
  await page.getByText("Вопрос об обработке").click();
  await page.getByRole("heading", { name: "Вопрос об обработке" }).waitFor();
  await page.getByRole("button", { name: "Написать письмо" }).click();
  const composeDialog = page.getByRole("dialog", { name: "Написать письмо" });
  await composeDialog.locator('summary[aria-label="От"]').click();
  await composeDialog.getByPlaceholder("Адрес или компания").fill("sales@");
  await composeDialog.getByRole("button", { name: /sales@inbox\.example\.test/ }).click();
  assert.equal(await composeDialog.locator('input[name="sourceId"]').inputValue(), salesMailbox.id);
  await composeDialog.locator('input[name="toAddress"]').fill("recipient@example.test");
  await composeDialog.locator('input[name="subject"]').fill("Предложение по обработке");
  await composeDialog.locator('textarea[name="bodyText"]').fill("Возможен выезд в октябре.");
  await composeDialog.getByRole("button", { name: "Отправить" }).click();
  await composeDialog.waitFor({ state: "hidden" });
  await page.getByText("Предложение по обработке").waitFor();
  const [queuedMail] = await sql`SELECT source_id, from_address, to_address, subject, body_text, status
    FROM mail_outbox WHERE organization_id = ${owner.organization_id} AND subject = 'Предложение по обработке'`;
  assert.equal(queuedMail.source_id, salesMailbox.id);
  assert.equal(queuedMail.from_address, "sales@inbox.example.test");
  assert.equal(queuedMail.to_address, "recipient@example.test");
  assert.equal(queuedMail.body_text, "Возможен выезд в октябре.");
  assert.equal(queuedMail.status, "pending");
  await page.getByRole("button", { name: "Написать письмо" }).click();
  await page.waitForTimeout(150);
  assert.equal(await composeDialog.isVisible(), true, "A previous successful send must not close a new draft");
  await composeDialog.locator('input[name="toAddress"]').fill("recipient@example.test");
  await composeDialog.locator('input[name="subject"]').fill("Черновик после ошибки");
  await composeDialog.locator('textarea[name="bodyText"]').fill("Этот текст нельзя потерять.");
  await sql`UPDATE mail_sources SET active = false WHERE id = ${salesMailbox.id}`;
  await composeDialog.getByRole("button", { name: "Отправить" }).click();
  await composeDialog.getByRole("alert").getByText("Не удалось поставить письмо в очередь.", { exact: false }).waitFor();
  assert.equal(await composeDialog.locator('input[name="toAddress"]').inputValue(), "recipient@example.test");
  assert.equal(await composeDialog.locator('input[name="subject"]').inputValue(), "Черновик после ошибки");
  assert.equal(await composeDialog.locator('textarea[name="bodyText"]').inputValue(), "Этот текст нельзя потерять.");
  await sql`UPDATE mail_sources SET active = true WHERE id = ${salesMailbox.id}`;
  await composeDialog.getByRole("button", { name: "Закрыть" }).click();
  const [mailRoot] = await sql`UPDATE mail_messages SET internet_message_id = '<root@customer.example.test>', headers_imported = true
    WHERE organization_id = ${owner.organization_id} AND subject = 'Вопрос об обработке' RETURNING id, thread_id`;
  await page.getByRole('button', { name: /^Входящие/ }).click();
  await page.locator('summary[aria-label="Почтовый ящик"]').click();
  await page.getByPlaceholder('Адрес или компания').fill('office@');
  await page.getByRole('button', { name: /office@inbox\.example\.test/ }).click();
  await page.getByRole('searchbox', { name: 'Найти письмо' }).fill('Вопрос об обработке');
  await page.getByText('Вопрос об обработке', { exact: true }).click();
  const reader = page.getByRole('article', { name: 'Просмотр письма' });
  await reader.getByText('Писем в переписке: 1', { exact: true }).waitFor();
  await reader.getByRole('button', { name: 'Ответить', exact: true }).click();
  const replyDialog = page.getByRole('dialog', { name: 'Ответить на письмо', exact: true });
  assert.equal(await replyDialog.locator('input[name="sourceId"]').inputValue(), officeMailbox.id);
  assert.equal(await replyDialog.locator('input[name="replyToMessageId"]').inputValue(), mailRoot.id);
  assert.equal(await replyDialog.locator('summary[aria-label="От"]').getAttribute('aria-disabled'), 'true');
  await replyDialog.locator('textarea[name="bodyText"]').fill('Подтверждаем время обработки.');
  let replyResponseLost = false;
  await page.route(`${baseUrl}/mail`, async route => {
    if (route.request().method() !== 'POST' || !route.request().headers()['next-action'] || replyResponseLost) return route.continue();
    replyResponseLost = true;
    const response = await route.fetch(); await response.body();
    await route.abort('failed');
  });
  await replyDialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await replyDialog.getByRole('alert').getByText('Соединение прервалось.', { exact: false }).waitFor();
  assert.equal(await replyDialog.locator('textarea[name="bodyText"]').inputValue(), 'Подтверждаем время обработки.');
  assert.equal((await sql`SELECT count(*)::integer AS total FROM mail_outbox WHERE body_text = 'Подтверждаем время обработки.'`)[0].total, 1);
  await page.unroute(`${baseUrl}/mail`);
  await replyDialog.getByRole('button', { name: 'Отправить', exact: true }).click();
  await replyDialog.waitFor({ state: 'hidden' });
  assert.equal((await sql`SELECT count(*)::integer AS total FROM mail_outbox WHERE body_text = 'Подтверждаем время обработки.'`)[0].total, 1);
  const [reply] = await sql`SELECT id, thread_id, in_reply_to, reference_ids, request_key FROM mail_outbox
    WHERE organization_id = ${owner.organization_id} AND body_text = 'Подтверждаем время обработки.'`;
  assert.equal(reply.thread_id, mailRoot.thread_id); assert.equal(reply.in_reply_to, '<root@customer.example.test>');
  assert.deepEqual(reply.reference_ids, ['<root@customer.example.test>']); assert.ok(reply.request_key);
  await page.getByText('Re: Вопрос об обработке', { exact: true }).click();
  await reader.getByText('Писем в переписке: 2', { exact: true }).waitFor();
  assert.equal(await reader.locator('[data-mail-message-id]').count(), 2);
  for (let index = 0; index < 35; index++) await saveIncomingMail(sql, {
    organizationId: owner.organization_id, mailbox: 'office@inbox.example.test', validity: 2, uid: index + 1,
    fromAddress: 'client@example.test', fromName: 'Клиент', toAddresses: ['office@inbox.example.test'],
    subject: 'Вопрос об обработке', bodyText: `Продолжение переписки ${index}`, raw: Buffer.from('Thread fixture'),
    receivedAt: new Date(Date.now() + index * 1000), recipientAddress: 'office@inbox.example.test', sourceId: officeMailbox.id,
  }, { messageId: `<followup-${index}@customer.example.test>`, inReplyTo: '<root@customer.example.test>', references: '<root@customer.example.test>' });
  await page.route('**/api/v1/mail/thread?**', route => route.fulfill({ status: 503, json: { error: { message: 'Проверочная ошибка переписки' } } }));
  await page.locator('.mail-row').filter({ hasText: 'Re: Вопрос об обработке' }).click();
  await reader.getByRole('alert').getByText('Проверочная ошибка переписки', { exact: false }).waitFor();
  await page.unroute('**/api/v1/mail/thread?**');
  await reader.getByRole('button', { name: 'Повторить', exact: true }).click();
  await reader.getByText('Писем в переписке: 37', { exact: true }).waitFor();
  assert.equal(await reader.locator('[data-mail-message-id]').count(), 30);
  await reader.getByRole('button', { name: 'Загрузить предыдущие письма', exact: true }).click();
  await reader.locator(`[data-mail-message-id="${mailRoot.id}"]`).waitFor();
  assert.equal(await reader.locator('[data-mail-message-id]').count(), 37);
  assert.equal(await reader.getByRole('button', { name: 'Загрузить предыдущие письма', exact: true }).count(), 0);
  const missingThread = await page.request.get(`${baseUrl}/api/v1/mail/thread?folder=inbox&id=${randomUUID()}`);
  assert.equal(missingThread.status(), 404);
  const [foreignMessage] = await sql`SELECT id FROM mail_messages WHERE organization_id <> ${owner.organization_id} LIMIT 1`;
  assert.equal((await page.request.get(`${baseUrl}/api/v1/mail/thread?folder=inbox&id=${foreignMessage.id}`)).status(), 404);
  assert.equal((await page.request.get(`${baseUrl}/api/v1/mail/thread?folder=inbox&id=bad-id`)).status(), 400);
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Mail overflows at ${width}px`);
    const mailboxFits = await page.locator('.mail-sidebar').evaluate(sidebar => {
      const trigger = sidebar.querySelector('summary').getBoundingClientRect();
      const bounds = sidebar.getBoundingClientRect();
      return trigger.left >= bounds.left && trigger.right <= bounds.right + 1;
    });
    assert.equal(mailboxFits, true, `Mailbox picker overlaps the letter list at ${width}px`);
    if (process.env.CRM_BROWSER_ARTIFACT_DIR) {
      await mkdir(process.env.CRM_BROWSER_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.CRM_BROWSER_ARTIFACT_DIR, `mail-thread-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/quick-order`);
  await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
  await page.getByTestId("quick-client-name").fill("Клиент удалённой услуги");
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-next").click();
  const remoteWorkSection = page.locator("#quick-work-section");
  await remoteWorkSection.locator('summary[aria-label="Из перечня товаров и услуг"]').click();
  await remoteWorkSection.getByPlaceholder("Название услуги или товара").fill("Янтарная услуга Ёж");
  await remoteWorkSection.getByRole("button", { name: /Янтарная услуга Ёж/ }).click();
  assert.equal(await remoteWorkSection.getByTestId("quick-service-name").inputValue(), "Янтарная услуга Ёж");
  assert.equal(await remoteWorkSection.getByTestId("quick-unit-price").inputValue(), "2.50");
  await page.getByTestId("quick-next").click();
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  assert.match(await remoteWorkSection.locator('summary[aria-label="Из перечня товаров и услуг"]').innerText(), /Янтарная услуга Ёж/);
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL((current) => /^\/orders\/[^/]+$/.test(current.pathname));
  const remoteOrderId = new URL(page.url()).pathname.split("/")[2];
  const [remoteLine] = await sql`SELECT catalog_item_id, service_name_snapshot, unit_price_minor
    FROM order_services WHERE organization_id = ${owner.organization_id} AND order_id = ${remoteOrderId}`;
  assert.equal(remoteLine.catalog_item_id, remoteCatalog.id);
  assert.equal(remoteLine.service_name_snapshot, "Янтарная услуга Ёж");
  assert.equal(Number(remoteLine.unit_price_minor), 250);
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const remoteEditDialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  const remoteServiceSummary = remoteEditDialog.locator('summary[aria-label="Из перечня товаров и услуг"]').first();
  await remoteServiceSummary.getByText("Янтарная услуга Ёж").waitFor();
  await remoteEditDialog.getByLabel("Количество услуги 1").fill("2");
  await remoteEditDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await remoteEditDialog.waitFor({ state: "hidden" });
  const [updatedRemoteLine] = await sql`SELECT catalog_item_id, line_total_minor FROM order_services
    WHERE organization_id = ${owner.organization_id} AND order_id = ${remoteOrderId}`;
  assert.equal(updatedRemoteLine.catalog_item_id, remoteCatalog.id);
  assert.equal(Number(updatedRemoteLine.line_total_minor), 500);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/services`);
  await page.getByRole("button", { name: "Показать ещё" }).waitFor();
  await page.getByRole("button", { name: "Показать ещё" }).click();
  await page.waitForFunction(() => document.querySelectorAll("article").length >= 100);
  await page.getByPlaceholder("Найти по названию или артикулу").fill("Янтарная услуга Ёж");
  const remoteCatalogCard = page.locator("article").filter({ hasText: "Янтарная услуга Ёж" });
  await remoteCatalogCard.waitFor();
  assert.equal(await page.locator("article").count(), 1);
  await remoteCatalogCard.getByRole("button", { name: "Изменить" }).click();
  const catalogDialog = page.getByRole("dialog", { name: "Изменить позицию" });
  await catalogDialog.getByLabel("Описание").fill("Проверено через серверный поиск");
  await catalogDialog.getByRole("button", { name: "Сохранить" }).click();
  await catalogDialog.waitFor({ state: "hidden" });
  const [editedCatalog] = await sql`SELECT description FROM catalog_items WHERE id = ${remoteCatalog.id}`;
  assert.equal(editedCatalog.description, "Проверено через серверный поиск");
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Services overflows at ${width}px`);
  }
  await sql`UPDATE catalog_items SET name = 'Новое имя янтарной услуги', active = false, version = version + 1
    WHERE organization_id = ${owner.organization_id} AND id = ${remoteCatalog.id}`;
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${baseUrl}/orders/${remoteOrderId}`);
    await page.getByRole("heading", { name: "Состав заказа" }).waitFor();
    assert.equal(await page.getByText("1. Янтарная услуга Ёж").count(), 1, `Historical service snapshot is missing at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, `Historical order overflows at ${width}px`);
  }
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const historicalEditDialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  assert.equal(await historicalEditDialog.getByLabel("Название услуги 1").inputValue(), "Янтарная услуга Ёж");
  await historicalEditDialog.locator('textarea[name="notes"]').fill("Историческая услуга сохранена");
  await historicalEditDialog.getByRole("button", { name: "Сохранить изменения" }).click();
  await historicalEditDialog.waitFor({ state: "hidden" });
  const [historicalLine] = await sql`SELECT catalog_item_id, service_name_snapshot, unit_price_minor, line_total_minor
    FROM order_services WHERE organization_id = ${owner.organization_id} AND order_id = ${remoteOrderId}`;
  const [historicalOrder] = await sql`SELECT notes FROM orders WHERE organization_id = ${owner.organization_id} AND id = ${remoteOrderId}`;
  assert.equal(historicalLine.catalog_item_id, remoteCatalog.id);
  assert.equal(historicalLine.service_name_snapshot, "Янтарная услуга Ёж");
  assert.equal(Number(historicalLine.unit_price_minor), 250);
  assert.equal(Number(historicalLine.line_total_minor), 500);
  assert.equal(historicalOrder.notes, "Историческая услуга сохранена");
  console.log("Incoming lead browser passed: 270-item lead search, simultaneous regular orders from two accounts, multi-contact intake, contract rates, five independent dates with per-date master/payout, fixed/overnight/window time, catalog quantities, notes and expenses; weekly series, per-date catalog item beyond 1000, mail search and page beyond 500 with source isolation, mail queue, threaded replies and 37-message pagination, retry after lost response without duplicate delivery, catalog selection/editing beyond 1000 items, and historical order editing after catalog rename/archive.");
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  if (sql) await sql.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
