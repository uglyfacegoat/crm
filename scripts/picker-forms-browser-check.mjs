import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { basename, dirname, join, resolve } from 'node:path';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import postgres from 'postgres';
import { chromium } from 'playwright-core';
import { runMigrations } from './migrate.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
const runtime = process.env.PICKER_FORMS_CHECK_RUNTIME;
assert.ok(adminUrl && process.env.CRM_TEST_FIXTURE_URL === adminUrl && runtime, 'Use the isolated npm test command and a built PICKER_FORMS_CHECK_RUNTIME.');
const base = 'http://127.0.0.1:3142';
const folder = await mkdtemp(join(tmpdir(), 'crm-picker-forms-'));
const databaseName = `crm_picker_forms_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${databaseName}`;
const accounts = {
  developer: { email: 'developer@arrival.invalid', password: randomBytes(32).toString('hex') },
  owner: { email: 'owner@arrival.invalid', password: randomBytes(32).toString('hex'), role: 'owner', name: 'Владелец расписания' },
  coordinator: { email: 'coordinator@arrival.invalid', password: randomBytes(32).toString('hex'), role: 'crm_coordinator', name: 'Координатор расписания' },
};
const env = { ...process.env, DATABASE_URL: databaseUrl.toString(), AUTH_MODE: 'required', CRM_ALLOWED_ORIGINS: base,
  CRM_TRUST_PROXY: 'false', AUTH_COOKIE_SECURE: 'false', AUTH_THROTTLE_SECRET: randomBytes(32).toString('hex'),
  AUTH_BOOTSTRAP_ADMIN_EMAIL: accounts.developer.email, AUTH_BOOTSTRAP_ADMIN_PASSWORD: accounts.developer.password,
  AUTH_BOOTSTRAP_ADMIN_NAME: 'Arrival developer', AUTH_BOOTSTRAP_ORGANIZATION_NAME: 'Arrival acceptance', AUTH_BOOTSTRAP_TIMEZONE: 'Europe/Moscow',
  AUTH_BOOTSTRAP_DEVELOPER: 'true', DOCUMENT_STORAGE_ROOT: folder, HOSTNAME: '127.0.0.1', PORT: '3142', NEXT_TELEMETRY_DISABLED: '1' };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false; let page;
async function saved(predicate) {
  for (let i = 0; i < 100; i++) { const result = await predicate(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Expected form state did not persist.');
}
async function login(target, account) {
  await target.goto(`${base}/login`);
  await target.getByPlaceholder('Email или телефон').fill(account.email);
  await target.getByPlaceholder('Пароль').fill(account.password);
  await target.getByRole('button', { name: 'Войти в CRM', exact: true }).click();
  await target.waitForURL(url => url.pathname === '/');
}
async function fit(target, dialog, width) {
  await target.setViewportSize({ width, height: 900 });
  assert.equal(await target.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Page overflow at ${width}`);
  assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `Dialog overflow at ${width}`);
}
try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: databaseUrl.toString(), onApplied: () => {} });
  assert.equal(spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/create-admin.ts'], { env, stdio: 'inherit' }).status, 0);
  sql = postgres(databaseUrl.toString(), { max: 2, onnotice: () => {} });
  const [principal] = await sql`SELECT organization_id FROM organization_members WHERE email = ${accounts.developer.email}`;
  for (const account of [accounts.owner, accounts.coordinator]) {
    assert.equal(spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/create-member.ts'], { env: { ...env,
      AUTH_MEMBER_ORGANIZATION_ID: principal.organization_id, AUTH_MEMBER_EMAIL: account.email, AUTH_MEMBER_PASSWORD: account.password,
      AUTH_MEMBER_NAME: account.name, AUTH_MEMBER_ROLE: account.role }, stdio: 'inherit' }).status, 0);
  }
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${principal.organization_id}, 'Picker customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address) VALUES (${principal.organization_id}, ${client.id}, 'Picker object', 'Office', 'Test address') RETURNING id`;
  const buildDirectory = dirname(dirname(resolve(runtime)));
  await cp(join(buildDirectory, 'static'), join(dirname(resolve(runtime)), basename(buildDirectory), 'static'), { recursive: true, force: true });
  await cp(resolve('public'), join(dirname(resolve(runtime)), 'public'), { recursive: true, force: true });
  server = spawn(process.execPath, [resolve(runtime)], { env, stdio: ['ignore', 'pipe', 'pipe'] }); serverExit = once(server, 'exit');
  server.stderr.on('data', c => process.stderr.write(c));
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 30000);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}`)); });
    server.stdout.on('data', c => { if (c.toString().includes('Ready in')) { clearTimeout(timeout); ready(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await login(page, accounts.owner);
  async function choose(scope, label, search, option) {
    const summary = scope.locator(`summary[aria-label="${label}"]`);
    await summary.click();
    const menu = summary.locator('..');
    await menu.getByRole('textbox').fill(search);
    const choice = menu.getByRole('button', { name: option, exact: true });
    const selectedLabel = await choice.locator('span').first().innerText();
    await choice.click();
    assert.equal(await menu.getAttribute('open'), null);
    assert.ok((await summary.innerText()).includes(selectedLabel));
  }
  await page.goto(`${base}/contracts`);
  await page.getByRole('button', { name: 'Новый договор', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Новый договор', exact: true });
  await choose(dialog, 'Клиент и объект', 'Picker', 'Picker customer · Picker object Test address');
  await dialog.locator('input[name="contractNumber"]').fill('PICKER-1');
  await dialog.locator('[data-form-name="startsOn"]').fill('01.01.2030');
  await dialog.locator('[data-form-name="endsOn"]').fill('31.01.2030');
  await choose(dialog, 'Стартовый статус', 'Черн', 'Черновик');
  await choose(dialog, 'Повтор', 'недел', 'По неделям');
  await dialog.locator('input[name="frequencyInterval"]').fill('2');
  await dialog.locator('[data-form-name="localTime"]').fill('09:30');
  await dialog.locator('input[name="durationMinutes"]').fill('90');
  // Toggling scheduling keeps the selected period, without sending two fields.
  await dialog.locator('input[name="scheduleEnabled"]').uncheck();
  assert.equal(await dialog.locator('input[name="frequencyUnit"]').count(), 1);
  await dialog.locator('input[name="scheduleEnabled"]').check();
  assert.equal(await dialog.locator('input[name="frequencyUnit"]').inputValue(), 'week');
  assert.equal(await dialog.locator('input[name="frequencyInterval"]').inputValue(), '2');
  assert.equal(await dialog.locator('[data-form-name="localTime"]').inputValue(), '09:30');
  assert.equal(await dialog.locator('input[name="durationMinutes"]').inputValue(), '90');
  for (const width of [390, 768, 1440]) {
    await fit(page, dialog, width);
    await dialog.locator('summary[aria-label="Повтор"]').click();
    const menu = dialog.locator('summary[aria-label="Повтор"]').locator('..');
    assert.ok(await menu.getByRole('textbox').isVisible());
    assert.equal(await menu.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await menu.getByRole('textbox').press('Escape');
    assert.ok(await dialog.isVisible(), 'Escape closes the list, not the dialog');
  }
  await dialog.getByRole('button', { name: 'Создать договор', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [contract] = await sql`SELECT id, status FROM contracts WHERE contract_number = 'PICKER-1'`;
  assert.equal(contract.status, 'draft');
  const [rule] = await sql`SELECT frequency_unit, frequency_interval, local_time::text, duration_minutes FROM contract_schedule_rules WHERE contract_id = ${contract.id}`;
  assert.equal(rule.frequency_unit, 'week'); assert.equal(rule.frequency_interval, 2);
  assert.equal(rule.local_time, '09:30:00'); assert.equal(rule.duration_minutes, 90);
  await page.getByRole('button', { name: 'Редактировать договор PICKER-1', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Редактировать договор', exact: true });
  assert.equal(await dialog.locator('input[name="status"]').inputValue(), 'draft');
  await choose(dialog, 'Статус', 'Дейст', 'Действует');
  await dialog.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await sql`SELECT status FROM contracts WHERE id = ${contract.id}`)[0].status, 'active');
  const [related] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    VALUES (${principal.organization_id}, ${client.id}, ${object.id}, 'PICKER-2', 'draft', '2030-01-01', '2030-01-31', 30) RETURNING id`;
  await page.reload();
  await page.getByRole('button', { name: 'Связать договор PICKER-1', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Связать договор', exact: true });
  await choose(dialog, 'Связанный договор', 'PICKER-2', 'PICKER-2 Picker customer');
  await choose(dialog, 'Тип связи', 'Дополн', 'Дополнительное соглашение');
  await dialog.getByRole('button', { name: 'Связать договоры', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await sql`SELECT relation_type FROM contract_relations WHERE organization_id = ${principal.organization_id} AND contract_a_id IN (${contract.id}, ${related.id}) AND contract_b_id IN (${contract.id}, ${related.id})`)[0].relation_type, 'supplement');
  console.log('Contract selectors: draft, weekly schedule, status update and supplement link persisted.');

  await sql`INSERT INTO object_service_profiles (organization_id, object_id, area_square_meters) VALUES (${principal.organization_id}, ${object.id}, 100)`;
  await sql`INSERT INTO object_service_rates (organization_id, object_id, name, billing_basis, quantity, unit_price_minor, position)
    VALUES (${principal.organization_id}, ${object.id}, 'Picker service', 'area', 1, 50, 1)`;
  await page.goto(`${base}/services`);
  await page.getByRole('tab', { name: /Условия по объектам/ }).click();
  const section = page.getByRole('region', { name: 'Условия объекта' });
  await section.getByRole('heading', { name: 'Picker object', exact: true }).waitFor();
  for (const [basis, search, label, priceLabel, quantity, expectedMinor] of [
    ['quantity', 'штуку', 'За штуку / количество', 'Цена за единицу, ₽', '3', 150],
    ['fixed', 'Фикс', 'Фиксированная сумма', 'Сумма, ₽', null, 50],
    ['area', 'м²', 'За м²', 'Цена за м², ₽', null, 5000],
  ]) {
    await choose(section, 'Расчёт', search, label);
    await section.getByLabel(priceLabel, { exact: false }).fill('0,50');
    if (quantity) await section.getByLabel('Количество', { exact: true }).fill(quantity);
    const expectedTotal = { 150: '1,50 ₽', 50: '0,50 ₽', 5000: '50 ₽' }[expectedMinor];
    await section.getByText(`Итого: ${expectedTotal}`, { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Сохранить условия', exact: true }).click();
    await saved(async () => (await sql`SELECT billing_basis FROM object_service_rates WHERE object_id = ${object.id}`)[0]?.billing_basis === basis);
    await section.getByRole('status').waitFor();
    const [storedRate] = await sql`SELECT billing_basis, quantity::text, unit_price_minor FROM object_service_rates WHERE object_id = ${object.id}`;
    assert.equal(storedRate.billing_basis, basis); assert.equal(Number(storedRate.unit_price_minor), 50);
    if (quantity) assert.equal(Number(storedRate.quantity), Number(quantity));
    await page.reload();
    await page.getByRole('tab', { name: /Условия по объектам/ }).click();
    assert.match(await section.locator('summary[aria-label="Расчёт"]').innerText(), new RegExp(label));
  }
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await section.locator('summary[aria-label="Расчёт"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Service menu overflow at ${width}`);
    await section.locator('summary[aria-label="Расчёт"]').locator('..').getByRole('textbox').press('Escape');
  }
  const [reader] = await sql`SELECT id FROM organization_members WHERE email = ${accounts.coordinator.email}`;
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${principal.organization_id}, ${reader.id}, 'orders.write', false)`;
  const readerPage = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await login(readerPage, accounts.coordinator);
  await readerPage.goto(`${base}/services`);
  await readerPage.getByRole('tab', { name: /Условия по объектам/ }).click();
  const readonlyPicker = readerPage.getByRole('region', { name: 'Условия объекта' }).locator('summary[aria-label="Расчёт"]');
  assert.equal(await readonlyPicker.getAttribute('aria-disabled'), 'true');
  await readonlyPicker.click();
  assert.equal(await readonlyPicker.locator('..').getAttribute('open'), null);
  assert.deepEqual(errors, []);
  console.log('Object service selectors: quantity, fixed and area calculations saved/reloaded; search, Escape and 390/768/1440px passed.');
} catch (error) {
  if (page) { await mkdir('artifacts/picker-forms', { recursive: true }); await page.screenshot({ path: 'artifacts/picker-forms/failure.png', timeout: 5000 }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-1800)); }
  throw error;
} finally {
  await browser?.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await serverExit; }
  await sql?.end(); try { if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`; } finally { await admin.end(); await rm(folder, { recursive: true, force: true }); }
}
