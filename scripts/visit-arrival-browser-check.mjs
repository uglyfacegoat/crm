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
const runtime = process.env.VISIT_CHECK_RUNTIME;
assert.ok(adminUrl && process.env.CRM_TEST_FIXTURE_URL === adminUrl && runtime, 'Use the isolated npm test command and a built VISIT_CHECK_RUNTIME.');
const base = 'http://127.0.0.1:3139';
const folder = await mkdtemp(join(tmpdir(), 'crm-visit-arrival-'));
const databaseName = `crm_arrival_${randomUUID().replaceAll('-', '')}`;
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
  AUTH_BOOTSTRAP_DEVELOPER: 'true', DOCUMENT_STORAGE_ROOT: folder, HOSTNAME: '127.0.0.1', PORT: '3139', NEXT_TELEMETRY_DISABLED: '1' };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false; let page;
async function saved(predicate) {
  for (let i = 0; i < 100; i++) { const result = await predicate(); if (result) return result; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Expected visit state did not persist.');
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
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${principal.organization_id}, 'Arrival customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address) VALUES (${principal.organization_id}, ${client.id}, 'Arrival object', 'Office', 'Test address') RETURNING id`;
  const orders = [];
  for (let n = 1; n <= 2; n++) {
    const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency, client_name_snapshot, object_name_snapshot, object_address_snapshot)
      VALUES (${principal.organization_id}, ${client.id}, ${object.id}, ${`ARRIVAL-${n}`}, 'new', 'RUB', 'Arrival customer', 'Arrival object', 'Test address') RETURNING id`;
    orders.push(order.id);
  }
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
  await page.goto(`${base}/orders/${orders[0]}`);
  await page.getByRole('button', { name: 'Добавить выезд', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Новый выезд', exact: true });
  assert.equal(await dialog.getByRole('button', { name: 'Точное время', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const width of [390, 768, 1440]) await fit(page, dialog, width);
  await dialog.locator('[data-form-name="localDate"]').fill('15.01.2030');
  await dialog.locator('[data-form-name="localTime"]').fill('10:00');
  await dialog.getByRole('button', { name: '1 ч', exact: true }).click();
  await dialog.getByRole('button', { name: 'Создать выезд', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [visit] = await sql`SELECT * FROM service_visits WHERE order_id = ${orders[0]}`;
  assert.equal(visit.arrival_mode, 'fixed');
  assert.equal((visit.scheduled_end_at - visit.scheduled_start_at) / 60000, 60);
  await page.getByRole('button', { name: /Редактировать выезд/ }).click();
  dialog = page.getByRole('dialog', { name: 'Редактировать выезд', exact: true });
  await dialog.getByRole('button', { name: 'Интервал приезда', exact: true }).click();
  await dialog.locator('[data-form-name="endTime"]').fill('11:30');
  await page.waitForTimeout(900);
  assert.equal((await sql`SELECT version FROM service_visits WHERE id = ${visit.id}`)[0].version, visit.version, 'Changing the mode requires a reason');
  await dialog.locator('textarea[name="rescheduleReason"]').fill('Согласовали интервал с заказчиком');
  await saved(async () => (await sql`SELECT arrival_mode FROM service_visits WHERE id = ${visit.id}`)[0].arrival_mode === 'window');
  await dialog.getByText('Сохранено', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: /Редактировать выезд/ }).click();
  assert.equal(await dialog.getByRole('button', { name: 'Интервал приезда', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await dialog.locator('[data-form-name="endTime"]').inputValue(), '11:30');
  await dialog.locator('[data-form-name="localTime"]').fill('23:30');
  await dialog.locator('[data-form-name="endTime"]').fill('00:30');
  await dialog.locator('textarea[name="rescheduleReason"]').fill('Ночная обработка');
  await saved(async () => (await sql`SELECT scheduled_start_at FROM service_visits WHERE id = ${visit.id}`)[0].scheduled_start_at.toISOString() === '2030-01-15T20:30:00.000Z');
  await dialog.getByText('Сохранено', { exact: true }).waitFor();
  assert.equal((await sql`SELECT scheduled_end_at FROM service_visits WHERE id = ${visit.id}`)[0].scheduled_end_at.toISOString(), '2030-01-15T21:30:00.000Z');
  await dialog.locator('textarea[name="notes"]').fill('Только заметка, интервал не меняется');
  await saved(async () => (await sql`SELECT notes FROM service_visits WHERE id = ${visit.id}`)[0].notes === 'Только заметка, интервал не меняется');
  await dialog.getByText('Сохранено', { exact: true }).waitFor();
  assert.equal((await sql`SELECT scheduled_end_at FROM service_visits WHERE id = ${visit.id}`)[0].scheduled_end_at.toISOString(), '2030-01-15T21:30:00.000Z');
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.goto(`${base}/calendar?date=2030-01-15&view=list&order=${orders[0]}`);
  await page.getByRole('button', { name: 'Перенести выезд ARRIVAL-1', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Перенести выезд', exact: true });
  for (const width of [390, 768, 1440]) await fit(page, dialog, width);
  assert.equal(await dialog.locator('[data-form-name="endTime"]').inputValue(), '00:30');
  await dialog.getByRole('button', { name: 'Точное время', exact: true }).click();
  await dialog.locator('[data-form-name="localTime"]').fill('09:00');
  await dialog.locator('textarea[name="rescheduleReason"]').fill('Согласовали точное время');
  await dialog.getByRole('button', { name: 'Перенести', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const [moved] = await sql`SELECT * FROM service_visits WHERE id = ${visit.id}`;
  assert.equal(moved.arrival_mode, 'fixed'); assert.equal((moved.scheduled_end_at - moved.scheduled_start_at) / 60000, 60);
  const [reminder] = await sql`SELECT due_at FROM tasks WHERE related_visit_id = ${visit.id}`;
  assert.equal(reminder.due_at.toISOString(), new Date(moved.scheduled_start_at - 86400000).toISOString());
  assert.equal((await sql`SELECT count(*)::integer AS count FROM service_visit_events WHERE visit_id = ${visit.id} AND event_type = 'schedule_changed'`)[0].count, 3);
  await page.goto(`${base}/orders/${orders[0]}`);
  await page.getByRole('button', { name: 'Копия и серия', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Копия и серия', exact: true });
  await dialog.getByRole('button', { name: /^Серия выездов/ }).click();
  const ordersBeforeSeries = (await sql`SELECT count(*)::integer AS count FROM orders WHERE organization_id = ${principal.organization_id}`)[0].count;
  await dialog.locator('[data-form-name="startsOn"]').fill('01.02.2030');
  await dialog.locator('[data-form-name="endsOn"]').fill('08.02.2030');
  await dialog.locator('summary[aria-label="Повторять"]').click();
  await dialog.getByRole('button', { name: 'Каждые N недель', exact: true }).click();
  await dialog.getByRole('button', { name: 'Интервал приезда', exact: true }).click();
  await dialog.locator('[data-form-name="overrideStartTime"]').fill('22:30');
  await dialog.locator('[data-form-name="overrideEndTime"]').fill('00:30');
  await dialog.getByRole('button', { name: 'Добавить 2 выезда', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const series = await sql`SELECT arrival_mode, scheduled_start_at, scheduled_end_at FROM service_visits WHERE organization_id = ${principal.organization_id} AND scheduled_start_at >= '2030-02-01' AND scheduled_start_at < '2030-02-09' AND order_id = ${orders[0]} AND series_id IS NOT NULL`;
  assert.equal((await sql`SELECT count(*)::integer AS count FROM orders WHERE organization_id = ${principal.organization_id}`)[0].count, ordersBeforeSeries);
  assert.equal(series.length, 2); for (const entry of series) { assert.equal(entry.arrival_mode, 'window'); assert.equal((entry.scheduled_end_at - entry.scheduled_start_at) / 60000, 120); }
  const coordinatorPage = await browser.newPage(); coordinatorPage.on('pageerror', e => errors.push(e.message)); await login(coordinatorPage, accounts.coordinator);
  await coordinatorPage.goto(`${base}/orders/${orders[1]}`); await coordinatorPage.getByRole('button', { name: 'Добавить выезд', exact: true }).click();
  dialog = coordinatorPage.getByRole('dialog', { name: 'Новый выезд', exact: true });
  await fit(coordinatorPage, dialog, 390); await dialog.getByRole('button', { name: 'Интервал приезда', exact: true }).click();
  await dialog.locator('[data-form-name="localDate"]').fill('17.01.2030'); await dialog.locator('[data-form-name="localTime"]').fill('08:00');
  await dialog.getByRole('button', { name: 'Создать выезд', exact: true }).click();
  assert.equal((await sql`SELECT count(*)::integer AS count FROM service_visits WHERE order_id = ${orders[1]}`)[0].count, 0, 'A missing window end blocks submission');
  await dialog.locator('[data-form-name="endTime"]').fill('08:45');
  await dialog.getByRole('button', { name: 'Создать выезд', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  const [coordinatorVisit] = await sql`SELECT id, arrival_mode, scheduled_start_at, scheduled_end_at FROM service_visits WHERE order_id = ${orders[1]}`;
  assert.equal(coordinatorVisit.arrival_mode, 'window'); assert.equal((coordinatorVisit.scheduled_end_at - coordinatorVisit.scheduled_start_at) / 60000, 45);
  await coordinatorPage.getByRole('button', { name: /Редактировать выезд/ }).click();
  dialog = coordinatorPage.getByRole('dialog', { name: 'Редактировать выезд', exact: true });
  await dialog.getByRole('button', { name: 'Точное время', exact: true }).click();
  assert.equal(await dialog.getByRole('button', { name: '45 мин', exact: true }).getAttribute('aria-pressed'), 'true');
  await dialog.locator('textarea[name="rescheduleReason"]').fill('Теперь точное время, длительность сохранена');
  await saved(async () => (await sql`SELECT arrival_mode FROM service_visits WHERE id = ${coordinatorVisit.id}`)[0].arrival_mode === 'fixed');
  assert.equal((await sql`SELECT extract(epoch from scheduled_end_at - scheduled_start_at)::integer AS seconds FROM service_visits WHERE id = ${coordinatorVisit.id}`)[0].seconds, 2700);
  assert.deepEqual(errors, []);
  console.log('Visit arrival browser passed: owner/coordinator create, required reason, autosave, reload, night window, calendar transfer, reminder/history, series and 390/768/1440px.');
} catch (error) {
  if (page) { await mkdir('artifacts/visits', { recursive: true }); await page.screenshot({ path: 'artifacts/visits/failure.png', timeout: 5000 }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-1800)); }
  throw error;
} finally {
  await browser?.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await serverExit; }
  await sql?.end(); try { if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`; } finally { await admin.end(); await rm(folder, { recursive: true, force: true }); }
}
