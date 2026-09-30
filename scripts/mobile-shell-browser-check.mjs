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
const runtime = process.env.MOBILE_SHELL_CHECK_RUNTIME;
assert.ok(adminUrl && process.env.CRM_TEST_FIXTURE_URL === adminUrl && runtime, 'Use the isolated npm test command and a built MOBILE_SHELL_CHECK_RUNTIME.');
const base = 'http://127.0.0.1:3141';
const folder = await mkdtemp(join(tmpdir(), 'crm-mobile-shell-'));
const databaseName = `crm_mobile_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl); databaseUrl.pathname = `/${databaseName}`;
const accounts = {
  developer: { email: 'developer@mobile.invalid', password: randomBytes(32).toString('hex') },
  owner: { email: 'owner@mobile.invalid', password: randomBytes(32).toString('hex'), role: 'owner', name: 'Владелец расписания' },
  coordinator: { email: 'coordinator@mobile.invalid', password: randomBytes(32).toString('hex'), role: 'crm_coordinator', name: 'Координатор расписания' },
};
const env = { ...process.env, DATABASE_URL: databaseUrl.toString(), AUTH_MODE: 'required', CRM_ALLOWED_ORIGINS: base,
  CRM_TRUST_PROXY: 'false', AUTH_COOKIE_SECURE: 'false', AUTH_THROTTLE_SECRET: randomBytes(32).toString('hex'),
  AUTH_BOOTSTRAP_ADMIN_EMAIL: accounts.developer.email, AUTH_BOOTSTRAP_ADMIN_PASSWORD: accounts.developer.password,
  AUTH_BOOTSTRAP_ADMIN_NAME: 'Arrival developer', AUTH_BOOTSTRAP_ORGANIZATION_NAME: 'Mobile shell acceptance', AUTH_BOOTSTRAP_TIMEZONE: 'Europe/Moscow',
  AUTH_BOOTSTRAP_DEVELOPER: 'true', DOCUMENT_STORAGE_ROOT: folder, HOSTNAME: '127.0.0.1', PORT: '3141', NEXT_TELEMETRY_DISABLED: '1' };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false; let page;
async function login(target, account) {
  await target.goto(`${base}/login`);
  await target.getByPlaceholder('Email или телефон').fill(account.email);
  await target.getByPlaceholder('Пароль').fill(account.password);
  await target.getByRole('button', { name: 'Войти в CRM', exact: true }).click();
  await target.waitForURL(url => url.pathname === '/');
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
  await sql`UPDATE orders SET agreed_total_minor = 123456789, paid_total_minor = 98765432
    WHERE id = ${orders[0]}`;
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
  await mkdir('artifacts/mobile-shell', { recursive: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // Explicitly simulate VisualViewport keyboard events and safe-area values.
  // Chromium desktop does not expose a real iPhone cutout or virtual keyboard.
  await page.addInitScript(() => {
    const viewport = new EventTarget(); let height = null; let top = 0;
    Object.defineProperties(viewport, { height: { get: () => height ?? innerHeight }, offsetTop: { get: () => top } });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.setTestViewport = (nextHeight, nextTop = 0) => { height = nextHeight; top = nextTop; viewport.dispatchEvent(new Event('resize')); };
  });
  async function safeArea(top = 59, bottom = 34, left = 0, right = 0) {
    await page.evaluate(({top,bottom,left,right}) => {
      const style = document.documentElement.style;
      for (const [side,value] of Object.entries({top,bottom,left,right})) style.setProperty(`--crm-safe-${side}`, `${value}px`);
    }, {top,bottom,left,right});
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--crm-viewport-height') !== '');
  }
  async function keyboard(height, top = 0) {
    await page.evaluate(({height,top}) => window.setTestViewport(height,top), {height,top});
    await page.waitForFunction(({height}) => document.documentElement.style.getPropertyValue('--crm-viewport-height') === `${height}px`, {height});
  }
  async function bounds(locator, top, bottom, left = 0, right = 0) {
    await locator.waitFor(); await page.waitForTimeout(200);
    const rect = await locator.boundingBox(); assert.ok(rect);
    assert.ok(rect.y >= top - 1 && rect.y + rect.height <= bottom + 1, `Vertical bounds ${JSON.stringify(rect)} expected ${top}..${bottom}`);
    assert.ok(rect.x >= left - 1 && rect.x + rect.width <= page.viewportSize().width - right + 1, 'Horizontal safe-area overflow');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, JSON.stringify(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).slice(0, 12).map(el => ({ tag: el.tagName, class: String(el.className).slice(0,100), rect: el.getBoundingClientRect().toJSON() })) }))));
  }
  await login(page, accounts.owner);
  // Open edge and central chart tooltips with real, nonzero persisted money.
  // The former last-bar tooltip added 142px to the mobile document width.
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/analytics`); await safeArea();
    await page.getByRole('heading', { name: 'Деньги по дням', exact: true }).waitFor();
    const bars = page.locator('.analytics-bar-group:visible');
    const count = await bars.count(); assert(count >= 5, 'Persisted amounts must produce a money chart');
    for (const index of [0, Math.floor(count / 2), count - 1]) {
      const bar = bars.nth(index); await bar.scrollIntoViewIfNeeded(); await bar.hover();
      await page.waitForFunction(() => [...document.querySelectorAll('.analytics-bar-group:hover')]
        .some((element) => getComputedStyle(element, '::after').opacity === '1'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `Money tooltip ${index + 1}/${count} overflows at ${width}px`);
      await page.mouse.move(0, 0); await page.keyboard.press('Tab'); await bar.focus();
      await page.waitForFunction(() => [...document.querySelectorAll('.analytics-bar-group:focus-visible')]
        .some((element) => getComputedStyle(element, '::after').opacity === '1'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `Keyboard tooltip ${index + 1}/${count} overflows at ${width}px`);
    }
    await page.screenshot({ path: `artifacts/mobile-shell/analytics-tooltip-${width}.png` });
  }
  for (const width of [390,768,1024]) {
    await page.setViewportSize({width,height:900}); await page.goto(`${base}/quick-order`); await safeArea();
    assert.ok((await page.getByRole('button', {name:'Открыть глобальный поиск',exact:true}).boundingBox()).y >= 59);
    await page.goto(`${base}/orders/${orders[0]}`); await safeArea();
    await page.getByRole('button',{name:'Добавить выезд',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Новый выезд',exact:true});
    await bounds(dialog,59,866);
    await dialog.locator('[data-form-name="localTime"]').focus(); await keyboard(440,24);
    await bounds(dialog,83,430);
    if (width < 768) assert.equal(await page.getByRole('navigation',{name:'Мобильная навигация'}).isVisible(),false);
    const create = dialog.getByRole('button',{name:'Создать выезд',exact:true}); await create.scrollIntoViewIfNeeded(); await bounds(create,83,430);
    await page.screenshot({path:`artifacts/mobile-shell/dialog-${width}.png`});
    await dialog.getByRole('button',{name:'Закрыть окно',exact:true}).click(); await keyboard(900);
    if (width < 768) assert.equal(await page.getByRole('navigation',{name:'Мобильная навигация'}).isVisible(),true);
  }
  await page.setViewportSize({width:844,height:390}); await page.goto(`${base}/orders/${orders[0]}`); await safeArea(0,21,44,44);
  await page.getByRole('button',{name:'Добавить выезд',exact:true}).click();
  await bounds(page.getByRole('dialog',{name:'Новый выезд',exact:true}),0,369,44,44);
  await page.getByRole('button',{name:'Закрыть окно',exact:true}).click();
  await page.setViewportSize({width:390,height:844}); await page.goto(`${base}/chat`);
  const [channel] = await sql`SELECT id FROM chat_channels WHERE organization_id = ${principal.organization_id} AND kind = 'general'`;
  assert.ok(channel); await page.goto(`${base}/chat?channel=${channel.id}`); await safeArea();
  assert.ok((await page.locator('.chat-back-link').boundingBox()).y >= 59);
  const composer = page.locator('textarea[name="body"]'); await composer.fill('Черновик сохраняется при клавиатуре'); await composer.focus(); await keyboard(410,18);
  await bounds(page.locator('.chat-standalone-shell'),18,428);
  await bounds(composer,77,394);
  await page.evaluate(() => window.scrollTo(0,500)); assert.equal(await page.evaluate(() => window.scrollY),0,'Chat must not scroll as a whole');
  await page.screenshot({path:'artifacts/mobile-shell/chat-keyboard.png'});
  await keyboard(844); assert.equal(await composer.inputValue(),'Черновик сохраняется при клавиатуре');
  await page.goto(`${base}/mail`); await safeArea();
  assert.ok((await page.locator('.chat-back-link').boundingBox()).y >= 59);
  await page.getByRole('button',{name:'Написать письмо',exact:true}).click();
  const mail = page.getByRole('dialog',{name:'Написать письмо',exact:true});
  await mail.locator('textarea[name="bodyText"]').fill('Сохранённый текст письма'); await mail.locator('textarea[name="bodyText"]').focus(); await keyboard(410,18);
  await bounds(mail,77,394);
  const cancel = mail.getByRole('button',{name:'Отмена',exact:true}); await cancel.scrollIntoViewIfNeeded(); await bounds(cancel,77,394);
  await page.screenshot({path:'artifacts/mobile-shell/mail-keyboard.png'}); await keyboard(844);
  assert.equal(await mail.locator('textarea[name="bodyText"]').inputValue(),'Сохранённый текст письма');
  await cancel.click(); await page.locator('.chat-back-link').click();
  await page.waitForURL(url => url.pathname === '/');
  await page.locator('.workspace-topbar').waitFor();
  await page.waitForFunction(() => !document.documentElement.classList.contains('chat-screen-open'));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('chat-screen-open')),false);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY),'hidden','Returning to CRM restores scrolling');
  assert.deepEqual(errors,[]);
  console.log('Mobile shell browser passed: money chart edge/middle tooltips by pointer and keyboard at 390/768/1024/1440px; simulated safe areas/keyboard, 390/768/1024px, landscape sides, order modal actions, chat lock/draft, mail composer, CRM return. Real iPhone/WebKit remains a separate check.');
} catch (error) {
  if (page) { await mkdir('artifacts/mobile-shell', { recursive: true }); await page.screenshot({ path: 'artifacts/mobile-shell/failure.png', timeout: 5000 }).catch(() => {}); console.error((await page.locator('body').innerText()).slice(-1800)); }
  throw error;
} finally {
  await browser?.close(); if (server && server.exitCode === null) { server.kill('SIGTERM'); await serverExit; }
  await sql?.end(); try { if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`; } finally { await admin.end(); await rm(folder, { recursive: true, force: true }); }
}
