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
async function viewport(target, width) {
  await target.setViewportSize({ width, height: 900 });
  // Wait for the existing sidebar/padding transition before measuring a tablet.
  await target.waitForFunction(() => {
    const sidebar = document.querySelector('.workspace-sidebar');
    const main = document.querySelector('main.workspace-main');
    if (!sidebar || !main || !sidebar.getBoundingClientRect().width) return true;
    return main.getBoundingClientRect().left >= sidebar.getBoundingClientRect().right - 1;
  });
}
async function fit(target, dialog, width) {
  await viewport(target, width);
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
  // Put the interesting records beyond the old 500-row limit. Fixtures remain
  // isolated; no real account, contact or master data is touched.
  const bulkMembers = Array.from({ length: 530 }, (_, i) => ({ organization_id: principal.organization_id,
    display_name: `Directory ${String(i).padStart(3, '0')}`, email: `directory-${i}@arrival.invalid`, role: 'sales_specialist' }));
  await sql`INSERT INTO organization_members ${sql(bulkMembers, 'organization_id', 'display_name', 'email', 'role')}`;
  const bulkMasters = Array.from({ length: 530 }, (_, i) => ({ organization_id: principal.organization_id,
    full_name: `Directory master ${String(i).padStart(3, '0')}`, phone: `+7900000${String(i).padStart(4, '0')}`, normalized_phone: `+7900000${String(i).padStart(4, '0')}`, service_region: 'Test', service_zone: 'Test' }));
  await sql`INSERT INTO masters ${sql(bulkMasters, 'organization_id', 'full_name', 'phone', 'normalized_phone', 'service_region', 'service_zone')}`;
  const [deepMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${principal.organization_id}, 'Яна Глубокая', 'deep-member@arrival.invalid', 'sales_specialist') RETURNING id`;
  const [deepMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${principal.organization_id}, 'Яков Глубокий', '+79995550011', '+79995550011', 'Test', 'Test') RETURNING id`;
  const [linkedMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${principal.organization_id}, 'Яков Занятый', '+79995550012', '+79995550012', 'Test', 'Test') RETURNING id`;
  const [linkedMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
    VALUES (${principal.organization_id}, 'Яна Занятая', 'linked-member@arrival.invalid', 'master', ${linkedMaster.id}) RETURNING id`;
  const [inactiveMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, active)
    VALUES (${principal.organization_id}, 'Яна Отключённая', 'inactive-member@arrival.invalid', 'sales_specialist', false) RETURNING id`;
  await sql`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value)
    VALUES (${principal.organization_id}, ${deepMember.id}, 'phone', '+79995550123')`;
  const [foreignOrg] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Foreign picker organization', 'Europe/Moscow') RETURNING id`;
  const [foreignMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${foreignOrg.id}, 'Чужой Глубокий', 'foreign@arrival.invalid', 'sales_specialist') RETURNING id`;
  await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone) VALUES (${foreignOrg.id}, 'Чужой Глубокий', '+79995559999', '+79995559999', 'Test', 'Test')`;
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
  async function preventAccidentalSubmit(scope) {
    await scope.evaluate(el => {
      const form = el.closest('form'); form.dataset.pickerSubmitCount = '0';
      form.addEventListener('submit', event => { form.dataset.pickerSubmitCount = String(Number(form.dataset.pickerSubmitCount) + 1); event.preventDefault(); });
    });
  }
  async function submitCount(scope) { return scope.evaluate(el => Number(el.closest('form').dataset.pickerSubmitCount)); }
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
  let releaseProfiles;
  const profileGate = new Promise((resolveGate) => { releaseProfiles = resolveGate; });
  let delayedProfile = false;
  await page.route('**/api/v1/services/profiles?q=*&page=0', async (route) => {
    if (delayedProfile) return route.continue();
    delayedProfile = true;
    const response = await route.fetch();
    await profileGate;
    await route.fulfill({ response });
  });
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
    if (quantity) {
      await section.getByLabel('Количество', { exact: true }).fill(quantity);
      releaseProfiles();
      await page.waitForLoadState('networkidle');
      assert.equal(await section.getByLabel('Количество', { exact: true }).inputValue(), quantity, 'A delayed response for the same object version must preserve edits');
    }
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
    await viewport(page, width);
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
  await page.goto(`${base}/settings/users/${reader.id}`);
  const roleChoice = page.getByRole('button', { name: 'Роль сотрудника', exact: true });
  const roleBefore = await page.locator('input[name="role"]').inputValue();
  assert.equal(await roleChoice.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent.trim()), 'Уровень 3 · Координатор CRM');
  await roleChoice.click();
  await mkdir('artifacts/picker-forms', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await viewport(page, width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Settings overflow at ${width}`);
    await roleChoice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/picker-forms/settings-${width}.png` });
  }
  const roleSearch = page.getByRole('textbox', { name: 'Поиск: Роль сотрудника', exact: true });
  await roleSearch.fill('Координатор');
  assert.equal(await page.getByRole('listbox', { name: 'Роль сотрудника' }).getByRole('option').count(), 1);
  await preventAccidentalSubmit(roleSearch);
  await roleSearch.press('Enter');
  assert.equal(await submitCount(roleSearch), 0, 'Enter in role search must not submit access form');
  await roleSearch.press('ArrowDown');
  assert.equal(await page.getByRole('option', { name: /Координатор CRM/ }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await roleChoice.evaluate(el => el === document.activeElement), true);
  // Remove the probe before submitting the actual permission change below.
  await page.reload();

  assert.equal(await page.locator('input[name="role"]').inputValue(), roleBefore);
  await roleChoice.click();
  await roleSearch.fill('Такой роли не существует');
  await page.getByText('Поиск не дал результатов', { exact: true }).waitFor();
  await roleSearch.press('Escape');
  assert.equal(await roleChoice.getAttribute('aria-expanded'), 'false');
  await roleChoice.click();
  assert.equal(await roleSearch.inputValue(), '');
  await roleSearch.press('Escape');
  const permission = page.locator('summary[aria-label="Заказы: Создавать, копировать и изменять"]');
  assert.match(await permission.innerText(), /Запретить/);
  await choose(page, 'Заказы: Создавать, копировать и изменять', 'Разреш', 'Разрешить');
  await page.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
  await page.getByText('Доступ сотрудника обновлён. Его активные сессии завершены.', { exact: true }).waitFor();
  assert.equal((await sql`SELECT allowed FROM member_permission_overrides WHERE member_id = ${reader.id} AND permission = 'orders.write'`)[0].allowed, true);
  assert.equal((await readerPage.request.get(`${base}/api/v1/auth/session`)).status(), 401);
  await login(readerPage, accounts.coordinator);
  await readerPage.goto(`${base}/services`);
  await readerPage.getByRole('tab', { name: /Условия по объектам/ }).click();
  assert.equal(await readonlyPicker.getAttribute('aria-disabled'), 'false');
  await readonlyPicker.click();
  assert.notEqual(await readonlyPicker.locator('..').getAttribute('open'), null);
  await readonlyPicker.locator('..').getByRole('textbox').press('Escape');
  console.log('Permission selector: search, explicit allow persisted, old session revoked, new session can edit services.');
  async function directory(query) {
    const response = await page.request.get(`${base}/api/v1/settings/members?${new URLSearchParams(query)}`);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['cache-control'], 'private, no-store');
    return (await response.json()).data;
  }
  const firstMembers = await directory({});
  assert.equal(firstMembers.total, 535); // 3 login accounts + 530 fillers + 2 active targets.
  assert.equal(firstMembers.items.length, 30);
  const lastMembers = await directory({ page: '18' });
  assert.ok(lastMembers.items.some(m => m.id === deepMember.id));
  assert.equal((await directory({ q: '79995550123' })).items[0].id, deepMember.id);
  assert.equal((await directory({ q: 'Менеджер продаж' })).total, 531);
  assert.equal((await directory({ status: 'inactive' })).items[0].id, inactiveMember.id);
  assert.equal((await directory({ status: 'all' })).total, 536);
  assert.equal((await directory({ q: 'Чужой Глубокий' })).total, 0);
  for (const params of ['page=0', 'page=hello', 'status=bogus', `q=${'a'.repeat(101)}`]) {
    assert.equal((await page.request.get(`${base}/api/v1/settings/members?${params}`)).status(), 400);
  }
  assert.equal((await readerPage.request.get(`${base}/api/v1/settings/members`)).status(), 403);
  assert.equal((await readerPage.request.get(`${base}/api/v1/settings/masters`)).status(), 403);
  assert.equal((await page.request.get(`${base}/api/v1/settings/masters?memberId=${foreignMember.id}`)).status(), 404);
  assert.equal((await page.request.get(`${base}/api/v1/settings/masters?memberId=bogus`)).status(), 400);
  const masterResults = await (await page.request.get(`${base}/api/v1/settings/masters?q=Глубокий`)).json();
  assert.deepEqual(masterResults.data.items.map(m => m.id), [deepMaster.id]);
  assert.equal((await (await page.request.get(`${base}/api/v1/settings/masters?q=Занятый`)).json()).data.items.length, 0);
  assert.equal((await (await page.request.get(`${base}/api/v1/settings/masters?q=Занятый&memberId=${linkedMember.id}`)).json()).data.items[0].id, linkedMaster.id);
  assert.equal((await page.goto(`${base}/settings/users/${foreignMember.id}`)).status(), 404);
  assert.equal((await page.goto(`${base}/settings/users/not-a-uuid`)).status(), 404);
  assert.equal((await page.goto(`${base}/settings/users/${deepMember.id}`)).status(), 200);
  await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Роль сотрудника', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск: Роль сотрудника', exact: true }).fill('Мастер');
  await page.getByRole('option', { name: 'Уровень 3 · Мастер', exact: true }).click();
  await choose(page, 'Карточка мастера', '79995550011', 'Яков Глубокий +79995550011');
  await page.getByRole('button', { name: 'Сохранить доступ', exact: true }).click();
  await saved(async () => (await sql`SELECT master_id FROM organization_members WHERE id = ${deepMember.id}`)[0].master_id === deepMaster.id);
  await page.reload();
  assert.match(await page.locator('summary[aria-label="Карточка мастера"]').innerText(), /Яков Глубокий/);
  assert.equal(await page.locator('input[name="masterId"]').inputValue(), deepMaster.id);
  const deepMasterSummary = page.locator('summary[aria-label="Карточка мастера"]');
  assert.equal(await deepMasterSummary.evaluate(el => document.getElementById(el.getAttribute('aria-describedby')).textContent.trim()), 'Яков Глубокий');
  for (const width of [390, 768, 1440]) {
    await viewport(page, width);
    await deepMasterSummary.scrollIntoViewIfNeeded(); await deepMasterSummary.click();
    const masterSearch = deepMasterSummary.locator('..').getByRole('textbox');
    await masterSearch.fill('Глубокий');
    await deepMasterSummary.locator('..').getByRole('button', { name: 'Яков Глубокий +79995550011', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Master picker overflow at ${width}`);
    await page.screenshot({ path: `artifacts/picker-forms/member-master-${width}.png` });
    await masterSearch.press('Escape');
    assert.equal(await deepMasterSummary.locator('..').getAttribute('open'), null);
    assert.equal(await page.locator('input[name="masterId"]').inputValue(), deepMaster.id);
  }
  await deepMasterSummary.click();
  const remoteMasterMenu = deepMasterSummary.locator('..');
  const remoteMasterSearch = remoteMasterMenu.getByRole('textbox');
  await page.route('**/api/v1/settings/masters?**', route => route.fulfill({ status: 503, json: { error: 'temporary' } }));
  await remoteMasterSearch.fill('Нет такого мастера');
  await remoteMasterMenu.getByText('Не удалось обновить список. Повторите запрос.', { exact: true }).waitFor();
  assert.equal(await remoteMasterMenu.getByText('Загрузка…', { exact: true }).count(), 0);
  await preventAccidentalSubmit(remoteMasterSearch);
  await remoteMasterSearch.press('Enter');
  assert.equal(await submitCount(remoteMasterSearch), 0, 'Enter in remote search must not submit access form');
  assert.equal(await page.locator('input[name="masterId"]').inputValue(), deepMaster.id);
  // Cached matches still show the failure and retry, not a silently truncated list.
  const failedMasterMatch = page.waitForResponse(response => response.url().includes('/api/v1/settings/masters?') && new URL(response.url()).searchParams.get('q') === 'Глубокий' && response.status() === 503);
  await remoteMasterSearch.fill('Глубокий'); await failedMasterMatch;
  await remoteMasterMenu.getByText('Не удалось обновить список. Повторите запрос.', { exact: true }).waitFor();
  await remoteMasterMenu.getByRole('button', { name: 'Яков Глубокий +79995550011', exact: true }).waitFor();
  await page.unroute('**/api/v1/settings/masters?**');
  await remoteMasterMenu.getByRole('button', { name: 'Повторить', exact: true }).click();
  await remoteMasterMenu.getByText('Не удалось обновить список. Повторите запрос.', { exact: true }).waitFor({ state: 'hidden' });
  await remoteMasterSearch.fill('');
  await remoteMasterMenu.getByRole('button', { name: 'Выберите мастера', exact: true }).waitFor();
  await remoteMasterSearch.press('ArrowDown');
  assert.equal(await remoteMasterMenu.locator('button[data-picker-option]').first().evaluate(el => el === document.activeElement), true, 'ArrowDown must move once to the first option');
  await page.keyboard.press('ArrowDown');
  assert.equal(await remoteMasterMenu.locator('button[data-picker-option]').nth(1).evaluate(el => el === document.activeElement), true, 'ArrowDown must move once to the second option');
  await remoteMasterSearch.fill('Глубокий');
  await remoteMasterMenu.getByRole('button', { name: 'Яков Глубокий +79995550011', exact: true }).waitFor();
  await remoteMasterSearch.press('ArrowDown'); await page.keyboard.press('End');
  assert.equal(await remoteMasterMenu.getByRole('button', { name: 'Яков Глубокий +79995550011', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await deepMasterSummary.locator('..').getAttribute('open'), null);
  assert.equal(await deepMasterSummary.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('input[name="masterId"]').inputValue(), deepMaster.id);
  await page.goto(`${base}/settings?tab=members`);
  const memberSearch = page.getByRole('textbox', { name: 'Поиск сотрудников', exact: true });
  const memberPages = page.getByRole('navigation', { name: 'Страницы сотрудников', exact: true });
  await memberPages.getByText('Найдено: 535 · Страница 1 из 18', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 30);
  await memberPages.getByRole('button', { name: 'Далее', exact: true }).click();
  await memberPages.getByText('Найдено: 535 · Страница 2 из 18', { exact: true }).waitFor();
  // Another administrator removes the last pages while this tab is open.
  await sql`UPDATE organization_members SET active = false WHERE organization_id = ${principal.organization_id}
    AND email LIKE 'directory-%' AND display_name >= 'Directory 025'`;
  await memberPages.getByRole('button', { name: 'Далее', exact: true }).click();
  await memberPages.getByText('Найдено: 30 · Страница 1 из 1', { exact: true }).waitFor();
  assert.equal(await page.getByRole('article').count(), 30);
  await sql`UPDATE organization_members SET active = true WHERE organization_id = ${principal.organization_id} AND email LIKE 'directory-%'`;
  await memberSearch.fill('Глубокая');
  await memberPages.getByText('Найдено: 1 · Страница 1 из 1', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Открыть настройки: Яна Глубокая', exact: true }).waitFor();
  for (const width of [390, 768, 1440]) {
    await viewport(page, width);
    assert.ok((await memberSearch.boundingBox()).width >= 150, `Usable search width at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Members overflow at ${width}`);
    await page.screenshot({ path: `artifacts/picker-forms/members-${width}.png` });
  }
  // Failure retains the search and offers retry; an old delayed search cannot
  // replace newer results after the user changes the query.
  await page.route('**/api/v1/settings/members?**', route => route.fulfill({ status: 503, json: { error: 'temporary' } }));
  await memberSearch.fill('Нет такого сотрудника');
  await page.getByRole('status').filter({ hasText: 'Не удалось загрузить сотрудников. Повторите запрос.' }).waitFor();
  assert.equal(await memberSearch.inputValue(), 'Нет такого сотрудника');
  await page.unroute('**/api/v1/settings/members?**');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await memberPages.getByText('Найдено: 0 · Страница 1 из 1', { exact: true }).waitFor();
  await memberSearch.fill('Глубокая');
  await memberPages.getByText('Найдено: 1 · Страница 1 из 1', { exact: true }).waitFor();
  let releaseSlow; const slowResponse = new Promise(resolve => { releaseSlow = resolve; });
  let markStarted; const slowStarted = new Promise(resolve => { markStarted = resolve; });
  await page.route('**/api/v1/settings/members?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'Directory 000') return route.continue();
    const response = await route.fetch(); markStarted(); await slowResponse;
    await route.fulfill({ response }).catch(() => {});
  });
  await memberSearch.fill('Directory 000'); await slowStarted;
  await memberSearch.fill('Глубокая');
  await memberPages.getByText('Найдено: 1 · Страница 1 из 1', { exact: true }).waitFor();
  releaseSlow(); await page.unroute('**/api/v1/settings/members?**');
  await page.getByRole('link', { name: 'Открыть настройки: Яна Глубокая', exact: true }).waitFor();
  // The closed activity tab must not preload every employee's buckets.
  let browserActivityReads = 0;
  await page.route('**/api/v1/settings/activity?**', async route => { browserActivityReads += 1; await route.continue(); });
  await page.goto(`${base}/settings?tab=members`);
  await page.waitForLoadState('networkidle');
  assert.equal(browserActivityReads, 0);
  await page.route('**/api/v1/profile/activity', route => route.fulfill({ status: 204 }));
  await sql`DELETE FROM member_screen_activity WHERE organization_id = ${principal.organization_id}`;
  await sql`INSERT INTO member_screen_activity (organization_id, member_id, bucket_start, screen_key)
    SELECT organization_id, id, now() - interval '2 hours', 'orders' FROM organization_members
    WHERE organization_id = ${principal.organization_id} AND deleted_at IS NULL`;
  await sql`INSERT INTO member_screen_activity (organization_id, member_id, bucket_start, screen_key, source)
    VALUES (${principal.organization_id}, ${deepMember.id}, now() - interval '12 days', 'mail', 'demo')`;
  const reportResponse = await page.request.get(`${base}/api/v1/settings/activity`);
  assert.equal(reportResponse.status(), 200);
  const fullReport = (await reportResponse.json()).data;
  assert.equal(fullReport.summary.memberCount, 536);
  assert.equal(fullReport.summary.totalSeconds, 536 * 30 + 30);
  assert.equal(fullReport.members.items.length, 30);
  assert.equal((await (await page.request.get(`${base}/api/v1/settings/activity?page=18`)).json()).data.members.items.length, 26);
  assert.equal((await readerPage.request.get(`${base}/api/v1/settings/activity`)).status(), 403);
  assert.equal((await page.request.get(`${base}/api/v1/settings/activity?memberId=${foreignMember.id}`)).status(), 404);
  const selectedReport = (await (await page.request.get(`${base}/api/v1/settings/activity?memberId=${deepMember.id}`)).json()).data;
  assert.equal(selectedReport.selected.seconds, 60);
  assert.equal(selectedReport.selected.demoSeconds, 30);
  await page.getByRole('tab', { name: 'Активность', exact: true }).click();
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('Яна Глубокая');
  const activityEmployee = page.getByRole('button', { name: /Яна Глубокая/ });
  await activityEmployee.focus();
  await activityEmployee.press('Enter');
  await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).waitFor();
  assert.equal(await activityEmployee.evaluate(element => element === document.activeElement), true, 'Selecting details preserves keyboard focus');
  assert(browserActivityReads > 0);
  await page.unroute('**/api/v1/settings/activity?**');
  const reportPages = page.locator('[aria-label="Страницы активности"]');
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('');
  await reportPages.getByText('Найдено: 536 · Страница 1 из 18', { exact: true }).waitFor();
  assert.equal(await page.locator('[aria-label="Сотрудники отчёта"]').getByRole('button').count(), 30);
  await reportPages.getByRole('button', { name: 'Далее', exact: true }).click();
  await reportPages.getByText('Найдено: 536 · Страница 2 из 18', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('Яна Глубокая');
  await page.getByRole('button', { name: /Яна Глубокая/ }).click();
  await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).waitFor();
  await page.getByRole('button', { name: '7 дней', exact: true }).click();
  await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).waitFor();
  const sevenReport = (await (await page.request.get(`${base}/api/v1/settings/activity?period=7&memberId=${deepMember.id}`)).json()).data;
  assert.equal(sevenReport.selected.seconds, 30);
  assert.equal(sevenReport.summary.totalSeconds, 536 * 30);
  assert.equal(await page.getByText('Из них демо: <1 мин', { exact: true }).count(), 0);
  await page.route('**/api/v1/settings/activity?**', route => route.fulfill({ status: 503, json: { error: { message: 'Отчёт временно недоступен' } } }));
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('Directory 000');
  await page.getByRole('alert').filter({ hasText: 'Отчёт временно недоступен' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).inputValue(), 'Directory 000');
  await page.unroute('**/api/v1/settings/activity?**');
  await page.getByRole('button', { name: 'Повторить загрузку отчёта', exact: true }).click();
  await page.getByRole('button', { name: /Directory 000/ }).waitFor();
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('Нет такого сотрудника');
  await page.getByText('Сотрудники не найдены.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).count(), 0);
  await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).fill('Яна Глубокая');
  await page.getByRole('heading', { name: 'Яна Глубокая', exact: true }).waitFor();
  for (const width of [390, 768, 1440]) {
    await viewport(page, width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Activity report fits ${width}`);
    await page.getByRole('textbox', { name: 'Найти сотрудника', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `artifacts/picker-forms/activity-${width}.png` });
  }
  await page.goto(`${base}/settings?tab=members`);
  await page.getByRole('button', { name: 'Новый сотрудник', exact: true }).click();
  const memberDialog = page.getByRole('dialog', { name: 'Новый сотрудник', exact: true });
  await memberDialog.locator('input[name="displayName"]').fill('Новый мастер поиска');
  await memberDialog.locator('input[name="email"]').fill('new-master@arrival.invalid');
  await memberDialog.locator('input[name="password"]').fill(randomBytes(24).toString('hex'));
  await memberDialog.getByRole('button', { name: 'Роль сотрудника', exact: true }).click();
  await memberDialog.getByRole('textbox', { name: 'Поиск: Роль сотрудника', exact: true }).fill('Мастер');
  await memberDialog.getByRole('option', { name: 'Уровень 3 · Мастер', exact: true }).click();
  await choose(memberDialog, 'Карточка мастера', '79000000529', 'Directory master 529 +79000000529');
  await memberDialog.getByRole('button', { name: 'Создать сотрудника', exact: true }).click();
  await memberDialog.waitFor({ state: 'hidden' });
  const [createdMasterAccount] = await sql`SELECT m.master_id, p.full_name FROM organization_members m
    JOIN masters p ON p.id = m.master_id AND p.organization_id = m.organization_id WHERE m.email = 'new-master@arrival.invalid'`;
  assert.equal(createdMasterAccount.full_name, 'Directory master 529');
  console.log('Directory: 537 accounts, 532 masters, last page/direct ID, persisted deep master, activity, error/retry, stale response and permission/scope checks passed.');
  await page.goto(`${base}/tasks`);
  await page.getByRole('button', { name: 'Новая задача', exact: true }).click();
  const taskDialog = page.getByRole('dialog', { name: 'Новая задача', exact: true });
  await taskDialog.locator('input[name="title"]').fill('Picker priority task');
  const prioritySummary = taskDialog.locator('summary[aria-label="Приоритет"]');
  await prioritySummary.click();
  const prioritySearch = prioritySummary.locator('..').getByRole('textbox');
  await prioritySearch.fill('Крит'); await prioritySearch.press('ArrowDown');
  assert.equal(await prioritySummary.locator('..').getByRole('button', { name: 'Критичный', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await taskDialog.locator('input[name="priority"]').inputValue(), 'critical');
  assert.equal(await prioritySummary.evaluate(el => el === document.activeElement), true);

  await taskDialog.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  await taskDialog.waitFor({ state: 'hidden' });
  assert.equal((await sql`SELECT priority FROM tasks WHERE title = 'Picker priority task'`)[0].priority, 'critical');
  assert.deepEqual(errors, []);
  console.log('Object service selectors: quantity, fixed and area calculations saved/reloaded; search, Escape and 390/768/1440px passed.');
} catch (error) {
  if (page) { await mkdir('artifacts/picker-forms', { recursive: true }); await page.screenshot({ path: 'artifacts/picker-forms/failure.png', timeout: 5000 }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-1800)); }
  throw error;
} finally {
  await browser?.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await serverExit; }
  await sql?.end(); try { if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`; } finally { await admin.end(); await rm(folder, { recursive: true, force: true }); }
}
