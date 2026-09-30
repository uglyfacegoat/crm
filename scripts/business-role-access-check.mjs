import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import postgres from "postgres";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { hashPassword } from "../src/server/auth/password.ts";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error("Run through the isolated PostgreSQL fixture.");
const baseUrl = "http://127.0.0.1:3117";
const runtime = resolve(process.env.BUSINESS_ROLE_CHECK_RUNTIME || ".next/standalone/server.js");
const directory = await mkdtemp(join(tmpdir(), "crm-business-roles-"));
const databaseName = `crm_business_roles_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const password = randomBytes(24).toString("hex");
const developerEmail = `developer-${randomUUID()}@example.invalid`;
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: "Role developer", AUTH_BOOTSTRAP_ADMIN_EMAIL: developerEmail,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Role acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3117" };
let browser; let sql; let server; let serverExit; let created = false;
const roles = ["deputy", "finance_controller", "sales_lead", "regional_director", "crm_coordinator", "tender_specialist", "foreman"];

async function login(email) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, { method: "POST", headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }) });
  assert.equal(response.status, 200, `${email} must log in`);
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie?.startsWith("crm_session="));
  return cookie;
}
async function path(cookie, route) {
  const response = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie }, redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") };
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "ignore" });
  assert.equal(bootstrap.status, 0, "bootstrap must succeed");
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const [home] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${developerEmail}`;
  await sql`UPDATE organizations SET organization_kind = 'center' WHERE id = ${home.organization_id}`;
  const [target] = await sql`INSERT INTO organizations (name, timezone, organization_kind, parent_organization_id)
    VALUES ('Second company', 'Europe/Moscow', 'company', ${home.organization_id}) RETURNING id`;
  const [developerShadow] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${target.id}, 'Developer company shadow', ${developerEmail}, 'admin') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${home.organization_id}, ${home.id}, ${target.id}, ${developerShadow.id})`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${target.id}, 'Клиент другого контура', 'legal_entity') RETURNING id`;
  const [companyOrder] = await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${target.id}, ${client.id}, 'ЦЕНТР-101', 'new', 'RUB', 'Клиент другого контура', 'Объект не указан', 'Адрес не указан') RETURNING id`;
  await sql`INSERT INTO clients (organization_id, legal_name, kind)
    SELECT ${target.id}, 'Дополнительный клиент ' || lpad(n::text, 3, '0'), 'individual' FROM generate_series(1, 66) n`;
  const [homeClient] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${home.organization_id}, 'Клиент центра', 'individual') RETURNING id`;
  await sql`INSERT INTO client_contacts (organization_id, client_id, full_name, phone, normalized_phone, is_primary)
    VALUES (${target.id}, ${client.id}, 'Контакт выданной компании', '+70000000008', '+70000000008', true)`;
  const [clientObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${target.id}, ${client.id}, 'Объект выданной компании', 'Склад', 'Тестовый адрес клиента') RETURNING id`;
  const [companyVisit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id,
      scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot,
      object_address_snapshot, created_by, updated_by)
    VALUES (${target.id}, ${companyOrder.id}, ${clientObject.id}, '2030-01-05T07:00:00Z', '2030-01-05T08:00:00Z',
      'planned', 'Клиент другого контура', 'Выезд выданной компании', 'Тестовый адрес клиента',
      ${developerShadow.id}, ${developerShadow.id}) RETURNING id`;
  const fileBytes = Buffer.from('center document access test');
  async function seedDocument(organizationId, clientId, orderId, creatorId, title) {
    const id = randomUUID();
    const storageKey = `${organizationId}/${id}/v1.pdf`;
    await mkdir(dirname(join(directory, storageKey)), { recursive: true });
    await writeFile(join(directory, storageKey), fileBytes);
    await sql`INSERT INTO documents (id, organization_id, client_id, order_id, title, category, created_by)
      VALUES (${id}, ${organizationId}, ${clientId}, ${orderId}, ${title}, 'contract', ${creatorId})`;
    const [version] = await sql`INSERT INTO document_versions (organization_id, document_id, version_number,
        original_filename, storage_key, mime_type, extension, size_bytes, sha256, uploaded_by)
      VALUES (${organizationId}, ${id}, 1, 'test.pdf', ${storageKey}, 'application/pdf', 'pdf', ${fileBytes.length},
        ${createHash('sha256').update(fileBytes).digest('hex')}, ${creatorId}) RETURNING id`;
    await sql`UPDATE documents SET current_version_id = ${version.id} WHERE id = ${id}`;
    return { id, versionId: version.id };
  }
  const grantedDocument = await seedDocument(target.id, client.id, companyOrder.id, developerShadow.id, 'Документ выданной компании');
  const [companySite] = await sql`INSERT INTO websites (organization_id, name, domain, status)
    VALUES (${target.id}, 'Сайт выданной компании', 'granted.example.invalid', 'active') RETURNING id`;
  const [ungrantedCompany] = await sql`INSERT INTO organizations (name, timezone, organization_kind, parent_organization_id)
    VALUES ('Ungrant company', 'Europe/Moscow', 'company', ${home.organization_id}) RETURNING id`;
  const [ungrantedSite] = await sql`INSERT INTO websites (organization_id, name, domain, status)
    VALUES (${ungrantedCompany.id}, 'Скрытый сайт', 'hidden.example.invalid', 'active') RETURNING id`;
  const [ungrantedMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${ungrantedCompany.id}, 'Ungrant creator', ${`ungranted-${randomUUID()}@example.invalid`}, 'admin') RETURNING id`;
  const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#4578aa' } }).webp().toBuffer();
  async function masterWithPhoto(organizationId) {
    const [record] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
      VALUES (${organizationId}, 'Avatar fixture master', '+70000000007', '+70000000007', 'Moscow', 'Center') RETURNING id`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
      VALUES (${organizationId}, 'Avatar fixture member', ${`avatar-${randomUUID()}@example.invalid`}, 'master', ${record.id}) RETURNING id`;
    await sql`INSERT INTO member_profile_avatars (organization_id, member_id, image_data) VALUES (${organizationId}, ${person.id}, ${photo})`;
    return { masterId: record.id, memberId: person.id };
  }
  const grantedPhoto = await masterWithPhoto(target.id);
  const hiddenPhoto = await masterWithPhoto(ungrantedCompany.id);
  const [ungrantedClient] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${ungrantedCompany.id}, 'Скрытый клиент', 'legal_entity') RETURNING id`;
  const [ungrantedOrder] = await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${ungrantedCompany.id}, ${ungrantedClient.id}, 'СКРЫТ-101', 'new', 'RUB', 'Скрытый клиент', 'Объект не указан', 'Адрес не указан') RETURNING id`;
  const ungrantedDocument = await seedDocument(ungrantedCompany.id, ungrantedClient.id, ungrantedOrder.id, ungrantedMember.id, 'Скрытый документ');
  await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    SELECT ${target.id}, ${client.id}, ${clientObject.id}, 'ДОГ-' || lpad(n::text, 4, '0'), 'draft', '2030-01-01', '2030-12-31', 30
    FROM generate_series(1, 520) n`;
  const [companyContract] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    VALUES (${target.id}, ${client.id}, ${clientObject.id}, 'Янтарный договор центра', 'active', '2030-01-01', '2030-12-31', 30) RETURNING id`;
  await sql`INSERT INTO contract_schedule_rules (organization_id, contract_id, frequency_unit, frequency_interval, local_time, starts_on, ends_on, default_master_id)
    VALUES (${target.id}, ${companyContract.id}, 'month', 1, '10:15', '2030-01-01', '2030-12-31', ${grantedPhoto.masterId})`;
  await sql`UPDATE service_visits SET contract_id = ${companyContract.id}, assigned_master_id = ${grantedPhoto.masterId},
    master_name_snapshot = 'Avatar fixture master' WHERE id = ${companyVisit.id}`;
  await sql`INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, after_state, reason)
    VALUES (${target.id}, ${companyContract.id}, ${developerShadow.id}, 'created', '{}'::jsonb, 'История выданного договора')`;
  await sql`UPDATE documents SET contract_id = ${companyContract.id}, object_id = null WHERE id = ${grantedDocument.id}`;
  const [hiddenObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${ungrantedCompany.id}, ${ungrantedClient.id}, 'Скрытый объект договора', 'Office', 'Тестовый адрес') RETURNING id`;
  const [calendarContract] = await sql`SELECT id FROM contracts WHERE organization_id = ${target.id} AND contract_number = 'ДОГ-0001'`;
  await sql`INSERT INTO service_visits (organization_id, contract_id, object_id, scheduled_start_at, scheduled_end_at, status,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by)
    SELECT ${target.id}, ${calendarContract.id}, ${clientObject.id}, '2030-01-06T00:00:00Z'::timestamptz + n * interval '1 hour',
      '2030-01-06T00:00:00Z'::timestamptz + (n + 1) * interval '1 hour', 'planned', 'Дополнительный выезд компании',
      'Объект календаря ' || n, 'Адрес календаря ' || n, ${developerShadow.id}, ${developerShadow.id} FROM generate_series(1, 73) n`;
  const [centerCalendarOrder] = await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency, client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${home.organization_id}, ${homeClient.id}, 'СВОЙ-901', 'new', 'RUB', 'Выезд центра для переноса', 'Собственный объект календаря', 'Адрес центра') RETURNING id`;
  const [centerCalendarObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${home.organization_id}, ${homeClient.id}, 'Собственный объект календаря', 'Склад', 'Адрес центра') RETURNING id`;
  const [centerVisit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id, scheduled_start_at, scheduled_end_at, status,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by)
    VALUES (${home.organization_id}, ${centerCalendarOrder.id}, ${centerCalendarObject.id}, '2030-01-05T11:00:00Z', '2030-01-05T12:00:00Z', 'planned',
      'Выезд центра для переноса', 'Собственный объект календаря', 'Адрес центра', ${home.id}, ${home.id}) RETURNING id`;
  const [hiddenContract] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    VALUES (${ungrantedCompany.id}, ${ungrantedClient.id}, ${hiddenObject.id}, 'Скрытый договор центра', 'draft', '2030-01-01', '2030-12-31', 30) RETURNING id`;
  const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${home.organization_id}, 'Field role master', '+70000000004', '+70000000004', 'Moscow', 'Center') RETURNING id`;
  const members = {};
  for (const role of roles) {
    const email = `${role}-${randomUUID()}@example.invalid`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
      VALUES (${home.organization_id}, ${`Role ${role}`}, ${email}, ${role}, ${role === "foreman" ? master.id : null}) RETURNING id`;
    await sql`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at)
      VALUES (${home.organization_id}, ${person.id}, 'email', ${email}, now())`;
    await sql`INSERT INTO member_credentials (organization_id, member_id, password_hash)
      VALUES (${home.organization_id}, ${person.id}, ${await hashPassword(password)})`;
    members[role] = { id: person.id, email };
  }
  const [shadow] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${target.id}, 'Deputy shadow', ${members.deputy.email}, 'admin') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${home.organization_id}, ${members.deputy.id}, ${target.id}, ${shadow.id})`;
  const buildDirectory = dirname(dirname(runtime));
  await cp(join(buildDirectory, "static"), join(dirname(runtime), basename(buildDirectory), "static"), { recursive: true, force: true });
  await cp(resolve("public"), join(dirname(runtime), "public"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  let stderr = ""; server.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timeout: ${stderr}`)), 30_000);
    server.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); ready(); } });
  });
  const expected = {
    deputy: { allowed: ["/contracts", "/documents", "/finance"], denied: ["/settings/users/" + members.sales_lead.id] },
    finance_controller: { allowed: ["/finance", "/analytics"], denied: ["/calendar"] },
    sales_lead: { allowed: ["/inbox", "/quick-order"], denied: ["/settings/users/" + members.deputy.id, "/finance", "/analytics", "/sites"] },
    regional_director: { allowed: ["/calendar", "/masters"], denied: ["/developer/support"] },
    crm_coordinator: { allowed: ["/orders", "/calendar"], denied: ["/finance"] },
    tender_specialist: { allowed: ["/contracts", "/documents"], denied: ["/finance"] },
    foreman: { allowed: ["/my-visits", "/chat"], denied: ["/orders", "/calendar", "/finance"] },
  };
  for (const role of roles) {
    const cookie = await login(members[role].email);
    const session = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).data.role, role);
    for (const route of expected[role].allowed) assert.equal((await path(cookie, route)).status, 200, `${role} ${route}: ${stderr}`);
    for (const route of expected[role].denied) {
      const result = await path(cookie, route);
      assert.ok(result.status >= 300 && result.status < 400, `${role} ${route} must redirect`);
    }
    if (role === "crm_coordinator") {
      const dashboard = await fetch(`${baseUrl}/`, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(dashboard.status, 200, `the CRM center must have its own dashboard: ${stderr}`);
      assert.match(await dashboard.text(), /Сегодня в работе/);
    }
    if (role === "deputy") {
      const dashboard = await fetch(`${baseUrl}/`, { headers: { Cookie: cookie }, redirect: "manual" });
      assert.equal(dashboard.status, 200, `the CRM center must show granted companies: ${stderr}`);
      await sql`UPDATE auth_sessions SET active_organization_id = ${target.id}, active_member_id = ${shadow.id}
        WHERE member_id = ${members.deputy.id} AND organization_id = ${home.organization_id}`;
      const switched = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { Cookie: cookie } });
      assert.equal(switched.status, 200);
      const data = (await switched.json()).data;
      assert.equal(data.role, "deputy", "shadow admin role must not elevate the principal");
      assert.equal(data.organizationId, target.id);
    }
  }
  await sql`INSERT INTO tasks (organization_id, title, due_at)
    SELECT ${target.id}, 'Просроченная задача компании ' || n, now() - interval '1 day'
    FROM generate_series(1, 510) AS n`;
  await sql`INSERT INTO tasks (organization_id, title, due_at)
    SELECT ${home.organization_id}, 'Просроченная задача центра ' || n, now() - interval '1 day'
    FROM generate_series(1, 2) AS n`;
  await sql`INSERT INTO tasks (organization_id, title, due_at)
    SELECT ${ungrantedCompany.id}, 'Скрытая просроченная задача ' || n, now() - interval '1 day'
    FROM generate_series(1, 7) AS n`;
  const developerCookie = await login(developerEmail);
  async function avatar(cookie, route, expectedPhoto) {
    const result = await fetch(`${baseUrl}${route}`, { headers: { Cookie: cookie } });
    assert.equal(result.status, 200, route);
    assert.equal(result.headers.get('content-type'), 'image/webp');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), expectedPhoto);
  }
  const grantedPhotoRoutes = [`/api/v1/members/${grantedPhoto.memberId}/avatar`, `/api/v1/masters/${grantedPhoto.masterId}/avatar`];
  for (const route of grantedPhotoRoutes) await avatar(developerCookie, route, photo);
  assert.equal((await path(developerCookie, `/api/v1/masters/${hiddenPhoto.masterId}/avatar`)).status, 404);
  assert.equal((await path(developerCookie, `/api/v1/members/${hiddenPhoto.memberId}/avatar`)).status, 404);
  assert.equal((await path(developerCookie, '/api/v1/masters/bad-id/avatar')).status, 404);
  assert.equal((await path(developerCookie, `/api/v1/masters/${randomUUID()}/avatar`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/v1/masters/${grantedPhoto.masterId}/avatar`)).status, 401);
  const replacement = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#ff8800' } }).webp().toBuffer();
  await sql`UPDATE member_profile_avatars SET image_data = ${replacement}, version = version + 1, updated_at = now()
    WHERE organization_id = ${target.id} AND member_id = ${grantedPhoto.memberId}`;
  for (const route of grantedPhotoRoutes) await avatar(developerCookie, route, replacement);
  const centerDashboard = await fetch(`${baseUrl}/`, { headers: { Cookie: developerCookie }, redirect: "manual" });
  assert.equal(centerDashboard.status, 200);
  const centerDashboardHtml = (await centerDashboard.text()).replaceAll(/<!--.*?-->/g, "");
  assert.ok(centerDashboardHtml.includes("512 просроченные задачи"),
    `center dashboard must count all granted tasks beyond the per-company 500-row limit: ${centerDashboardHtml.match(/.{0,50}просроченные задачи.{0,40}/)?.[0]}`);
  const centerOrder = await fetch(`${baseUrl}/orders/${companyOrder.id}`, { headers: { Cookie: developerCookie }, redirect: "manual" });
  assert.equal(centerOrder.status, 200);
  const centerOrderHtml = await centerOrder.text();
  assert.match(centerOrderHtml, /Клиент другого контура/);
  assert.match(centerOrderHtml, /Документ выданной компании/);
  assert.match(centerOrderHtml, /История и детали/);
  assert.match(centerOrderHtml, new RegExp(`/api/v1/documents/${grantedDocument.id}/versions/${grantedDocument.versionId}/download`));
  const [developerSession] = await sql`SELECT active_organization_id FROM auth_sessions
    WHERE organization_id = ${home.organization_id} AND member_id = ${home.id} ORDER BY created_at DESC LIMIT 1`;
  assert.equal(developerSession.active_organization_id, null, "reading from the center must not switch the active company");
  async function clientPage(cookie, params = '') {
    const response = await fetch(`${baseUrl}/api/v1/clients${params}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return (await response.json()).data;
  }
  const firstClients = await clientPage(developerCookie);
  const nextClients = await clientPage(developerCookie, '?page=2');
  assert.equal(firstClients.total, 68);
  assert.equal(firstClients.summary.total, 68);
  assert.equal(firstClients.summary.active, 2);
  assert.equal(firstClients.summary.objects, 2);
  assert.equal(firstClients.items.length, 50);
  assert.equal(nextClients.items.length, 18);
  assert.equal(new Set([...firstClients.items, ...nextClients.items].map(item => item.id)).size, 68);
  const matching = await clientPage(developerCookie, '?q=' + encodeURIComponent('Контакт выданной'));
  assert.equal(matching.total, 1);
  assert.equal(matching.items[0].id, client.id);
  assert.equal(matching.items[0].organizationName, 'Second company');
  assert.equal(matching.summary.total, 68, 'Search must not shrink full client statistics');
  const foreignClient = await fetch(`${baseUrl}/clients/${client.id}`, { headers: { Cookie: developerCookie }, redirect: 'manual' });
  assert.equal(foreignClient.status, 200);
  const clientHtml = await foreignClient.text();
  assert.match(clientHtml, /просмотр в центре CRM/);
  assert.match(clientHtml, /Контакт выданной компании/);
  assert.match(clientHtml, /Объект выданной компании/);
  assert.doesNotMatch(clientHtml, />Изменить клиента</);
  assert.equal((await path(developerCookie, `/clients/${ungrantedClient.id}`)).status, 404);
  for (const [q, entityId] of [['Клиент другого контура', client.id], ['Объект выданной компании', clientObject.id]]) {
    const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(q)}`, { headers: { Cookie: developerCookie } });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).data.results.some(item => item.id === entityId && item.href === `/clients/${client.id}` && item.subtitle.includes('Second company')));
  }
  for (const [q, entityId] of [['ЦЕНТР-101', companyOrder.id], ['Выезд выданной компании', companyVisit.id], ['05.01.2030', companyVisit.id]]) {
    const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(q)}`, { headers: { Cookie: developerCookie } });
    assert.equal(response.status, 200);
    const result = (await response.json()).data.results.find(item => item.id === entityId);
    assert.ok(result, `Center search must include granted record: ${q}`);
    assert.equal(result.href, `/orders/${companyOrder.id}`);
    assert.ok(result.subtitle.includes('Second company'));
    assert.equal((await path(developerCookie, result.href)).status, 200);
  }
  const hiddenSearch = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('Скрытый клиент')}`, { headers: { Cookie: developerCookie } });
  assert.deepEqual((await hiddenSearch.json()).data.results, []);

  async function contractPage(params = '') {
    const response = await fetch(`${baseUrl}/api/v1/contracts${params}`, { headers: { Cookie: developerCookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    return (await response.json()).data;
  }
  const contractIds = [];
  for (let number = 1; number <= 11; number++) {
    const result = await contractPage(`?page=${number}`);
    assert.equal(result.total, 521);
    assert.equal(result.summary.total, 521);
    contractIds.push(...result.items.map(item => item.id));
  }
  assert.equal(new Set(contractIds).size, 521);
  const byNumber = await contractPage('?q=' + encodeURIComponent('Янтарный договор центра'));
  assert.equal(byNumber.total, 1);
  assert.equal(byNumber.items[0].id, companyContract.id);
  assert.equal((await contractPage(`?master=${grantedPhoto.masterId}`)).total, 1);
  assert.equal((await path(developerCookie, `/contracts/${hiddenContract.id}`)).status, 404);
  assert.equal((await path(developerCookie, `/calendar?contract=${hiddenContract.id}&date=2030-01-05`)).status, 404);
  const contractResult = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('Янтарный договор центра')}`, { headers: { Cookie: developerCookie } });
  const foundContract = (await contractResult.json()).data.results.find(item => item.id === companyContract.id);
  assert.equal(foundContract.href, `/contracts/${companyContract.id}`);
  assert.ok(foundContract.subtitle.includes('Second company'));
  browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'crm_session', value: developerCookie.slice('crm_session='.length), url: baseUrl }]);
  const page = await context.newPage();
  async function settledLayout() {
    await page.waitForFunction(() => {
      const side = document.querySelector('.workspace-sidebar');
      const main = document.querySelector('main.workspace-main');
      return !side || !main || !side.getBoundingClientRect().width || main.getBoundingClientRect().left >= side.getBoundingClientRect().right - 1;
    });
  }
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await mkdir('artifacts/business-roles', { recursive: true });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseUrl}/clients`);
    await page.getByPlaceholder('Клиент, ИНН, телефон или e-mail').fill('Клиент другого контура');
    const link = page.getByRole('link', { name: 'Открыть клиента Клиент другого контура', exact: true }).filter({ visible: true });
    await link.waitFor();
    await link.click();
    await page.waitForURL(`${baseUrl}/clients/${client.id}`);
    await page.getByRole('heading', { name: 'Клиент другого контура', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Изменить клиента', exact: true }).count(), 0);
    assert.ok(await page.getByText('просмотр в центре CRM', { exact: false }).isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/business-roles/center-client-${width}.png`, fullPage: true });
    for (const query of ['ЦЕНТР-101', 'Выезд выданной компании']) {
      await page.getByRole('button', { name: 'Открыть глобальный поиск', exact: true }).click();
      const search = page.getByRole('dialog', { name: 'Глобальный поиск', exact: true });
      await search.getByRole('combobox').fill(query);
      const result = search.getByRole('option', { name: query === 'ЦЕНТР-101' ? /Заказ №ЦЕНТР-101/ : /Выезд · Клиент другого контура/ });
      await result.waitFor();
      assert.ok((await result.textContent()).includes('Second company'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await result.click();
      await page.waitForURL(`${baseUrl}/orders/${companyOrder.id}`);
      await page.getByRole('heading', { name: 'Заказ ЦЕНТР-101', exact: true }).waitFor();
    }
    await page.goto(`${baseUrl}/clients/${client.id}`);
  }
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseUrl}/contracts`);
    await settledLayout();
    await page.getByRole('navigation', { name: 'Страницы договоров' }).getByText('Страница 1 из 11', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Следующая страница', exact: true }).click();
    await page.getByRole('navigation', { name: 'Страницы договоров' }).getByText('Страница 2 из 11', { exact: true }).waitFor();
    await page.getByPlaceholder('Номер, клиент, объект, адрес или мастер').fill('Янтарный договор центра');
    const link = page.getByRole('link', { name: 'Янтарный договор центра', exact: true });
    await link.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Редактировать договор Янтарный договор центра', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await settledLayout();
    assert.equal(await page.evaluate(() => {
      const side = document.querySelector('.workspace-sidebar');
      const heading = document.querySelector('main h1');
      return side && getComputedStyle(side).display !== 'none' && heading.getBoundingClientRect().left < side.getBoundingClientRect().right - 1;
    }), false, `Contract heading must stay outside the sidebar at ${width}px`);
    await page.screenshot({ animations: 'disabled', path: `artifacts/business-roles/center-contract-list-${width}.png`, fullPage: true });
    await link.click();
    await page.waitForURL(`${baseUrl}/contracts/${companyContract.id}`);
    await page.getByRole('heading', { name: 'Янтарный договор центра', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Данные и статус', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Продлить', exact: true }).count(), 0);
    await page.getByText('История выданного договора', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Скачать документ', exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `artifacts/business-roles/center-contract-${width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Открыть календарь', exact: true }).click();
    await page.getByText('Календарь договора Янтарный договор центра · Second company · просмотр в центре CRM', { exact: true }).waitFor();
    await page.getByRole('link').filter({ hasText: 'Выезд выданной компании' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Перенести выезд/ }).count(), 0);
    await page.getByRole('button', { name: 'Открыть карточку мастеру', exact: true }).click();
    const dispatch = page.getByRole('dialog', { name: 'Карточка мастеру', exact: true });
    await dispatch.getByText(/Название объекта: Выезд выданной компании/).waitFor();
    await dispatch.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Открыть глобальный поиск', exact: true }).click();
    const search = page.getByRole('dialog', { name: 'Глобальный поиск', exact: true });
    await search.getByRole('combobox').fill('Янтарный договор центра');
    await search.getByRole('option', { name: /Янтарный договор центра/ }).click();
    await page.getByRole('heading', { name: 'Янтарный договор центра', exact: true }).waitFor();
  }
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseUrl}/calendar?date=2030-01-05&view=list`);
    const visitPages = page.getByRole('navigation', { name: 'Страницы выездов', exact: true });
    await visitPages.getByText('Страница 1 из 2', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Открыть карточку мастеру', exact: true }).count(), 50);
    assert.equal(await page.getByRole('button', { name: /Перенести выезд/ }).count(), 1, 'Only the own-center visit can be rescheduled');
    await page.getByRole('link').filter({ hasText: 'Выезд выданной компании' }).waitFor();
    await visitPages.getByRole('button', { name: 'Следующие выезды', exact: true }).click();
    await visitPages.getByText('Страница 2 из 2', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Открыть карточку мастеру', exact: true }).count(), 25);
    assert.equal(await page.getByRole('button', { name: /Перенести выезд/ }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Unfiltered visit pages must fit the viewport');
    await page.getByPlaceholder('Номер, клиент, адрес, мастер или услуга').fill('Выезд центра для переноса');
    assert.equal(await page.getByRole('button', { name: /Перенести выезд/ }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Открыть карточку мастеру', exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ animations: 'disabled', path: `artifacts/business-roles/center-calendar-${width}.png`, fullPage: true });
  }
  const standaloneVisitSearch = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('Дополнительный выезд компании')}`, { headers: { Cookie: developerCookie } });
  const standaloneVisits = (await standaloneVisitSearch.json()).data.results.filter(item => item.entityType === 'visit');
  assert.ok(standaloneVisits.length > 0);
  assert.ok(standaloneVisits.every(item => item.href.startsWith('/calendar?view=list&date=') && item.subtitle.includes('Second company')));
  assert.equal((await path(developerCookie, standaloneVisits[0].href)).status, 200);
  await page.goto(`${baseUrl}/contracts`);
  const contractSearch = page.getByPlaceholder('Номер, клиент, объект, адрес или мастер');
  await page.route('**/api/v1/contracts?**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await contractSearch.fill('Янтарный договор центра');
  await page.getByText('Не удалось загрузить договоры.', { exact: true }).waitFor();
  assert.equal(await contractSearch.inputValue(), 'Янтарный договор центра');
  await page.unroute('**/api/v1/contracts?**');
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.getByRole('link', { name: 'Янтарный договор центра', exact: true }).waitFor();
  await page.getByRole('button', { name: 'История договора Янтарный договор центра', exact: true }).filter({ visible: true }).first().click();
  const contractHistory = page.getByRole('dialog', { name: 'История договора', exact: true });
  await contractHistory.getByText('История выданного договора', { exact: true }).waitFor();
  await contractHistory.getByRole('button', { name: 'Закрыть окно', exact: true }).click();
  await page.getByRole('button', { name: 'Фильтры', exact: true }).click();
  const filters = page.getByRole('dialog', { name: 'Фильтры договоров', exact: true });
  const masterMenu = filters.locator('summary[aria-label="Мастер договора"]').locator('..');
  await masterMenu.locator('summary').click();
  await masterMenu.getByPlaceholder('Имя или телефон мастера').fill('Avatar fixture master');
  await masterMenu.getByRole('button', { name: /Avatar fixture master.*Second company/ }).click();
  await filters.getByRole('button', { name: 'Показать договоры', exact: true }).click();
  await page.getByRole('link', { name: 'Янтарный договор центра', exact: true }).waitFor();
  await page.goto(`${baseUrl}/clients/${client.id}`);
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Мои заметки', exact: true }) });
  await panel.getByRole('button', { name: 'Новая заметка', exact: true }).click();
  await panel.getByPlaceholder('Например, детали объекта').fill('Личная заметка центра');
  await panel.getByPlaceholder('Запишите важное для себя…').fill('Проверка клиента без смены компании');
  await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Заметка сохранена' }).waitFor();
  await page.reload();
  await panel.getByText('Проверка клиента без смены компании', { exact: true }).waitFor();
  const [note] = await sql`SELECT owner_organization_id, owner_member_id, target_organization_id, target_id
    FROM personal_notes WHERE title = 'Личная заметка центра'`;
  assert.equal(note.owner_organization_id, home.organization_id);
  assert.equal(note.owner_member_id, home.id);
  assert.equal(note.target_organization_id, target.id);
  assert.equal(note.target_id, client.id);
  await panel.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await panel.getByPlaceholder('Номер заказа или имя клиента').fill('Клиент центра');
  await panel.getByRole('button', { name: 'Клиент · Клиент центра', exact: true }).click();
  await panel.getByRole('status').filter({ hasText: 'Копия создана' }).waitFor();
  await page.goto(`${baseUrl}/clients/${homeClient.id}`);
  await page.getByText('Проверка клиента без смены компании', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Дублировать', exact: true }).click();
  await page.getByPlaceholder('Номер заказа или имя клиента').fill('Клиент другого контура');
  await page.getByRole('button', { name: 'Клиент · Клиент другого контура Second company', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Копия создана' }).waitFor();
  assert.deepEqual(errors, []);
  const [unchangedSession] = await sql`SELECT active_organization_id FROM auth_sessions
    WHERE organization_id = ${home.organization_id} AND member_id = ${home.id} ORDER BY created_at DESC LIMIT 1`;
  assert.equal(unchangedSession.active_organization_id, null);
  await context.close();
  const siteList = await fetch(`${baseUrl}/sites`, { headers: { Cookie: developerCookie }, redirect: "manual" });
  assert.equal(siteList.status, 200);
  const siteListHtml = await siteList.text();
  assert.match(siteListHtml, /Сайт выданной компании/);
  assert.doesNotMatch(siteListHtml, /Скрытый сайт/);
  const siteDetail = await path(developerCookie, `/sites/${companySite.id}`);
  assert.equal(siteDetail.status, 200);
  assert.equal((await path(developerCookie, `/sites/${ungrantedSite.id}`)).status, 404);
  const centerDocument = await fetch(`${baseUrl}/api/v1/documents/${grantedDocument.id}/download`, { headers: { Cookie: developerCookie } });
  assert.equal(centerDocument.status, 200);
  assert.deepEqual(Buffer.from(await centerDocument.arrayBuffer()), fileBytes);
  assert.equal((await path(developerCookie, `/api/v1/documents/${grantedDocument.id}/versions/${grantedDocument.versionId}/download`)).status, 200);
  assert.equal((await path(developerCookie, `/api/v1/documents/${ungrantedDocument.id}/download`)).status, 404);
  const companyEmail = `company-coordinator-${randomUUID()}@example.invalid`;
  const [companyCoordinator] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${target.id}, 'Company coordinator', ${companyEmail}, 'crm_coordinator') RETURNING id`;
  await sql`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at)
    VALUES (${target.id}, ${companyCoordinator.id}, 'email', ${companyEmail}, now())`;
  await sql`INSERT INTO member_credentials (organization_id, member_id, password_hash)
    VALUES (${target.id}, ${companyCoordinator.id}, ${await hashPassword(password)})`;
  const companyCookie = await login(companyEmail);
  const companyClients = await clientPage(companyCookie);
  assert.equal(companyClients.total, 67);
  assert.ok(!companyClients.items.some(item => item.id === homeClient.id || item.id === ungrantedClient.id));
  assert.equal((await path(companyCookie, `/clients/${homeClient.id}`)).status, 404);
  const companyClientDetail = await fetch(`${baseUrl}/clients/${client.id}`, { headers: { Cookie: companyCookie } });
  assert.doesNotMatch(await companyClientDetail.text(), /Личная заметка центра/);
  await avatar(companyCookie, `/api/v1/masters/${grantedPhoto.masterId}/avatar`, replacement);
  assert.equal((await path(companyCookie, `/api/v1/masters/${hiddenPhoto.masterId}/avatar`)).status, 404);
  const companyDashboard = await fetch(`${baseUrl}/`, { headers: { Cookie: companyCookie }, redirect: "manual" });
  assert.equal(companyDashboard.status, 200, `a new role must open a company dashboard: ${stderr}`);
  const companyDashboardHtml = (await companyDashboard.text()).replaceAll(/<!--.*?-->/g, "");
  assert.match(companyDashboardHtml, /Сегодня в работе/);
  assert.match(companyDashboardHtml, /510 просроченные задачи/);
  const fieldCookie = await login(members.foreman.email);
  assert.equal((await path(fieldCookie, `/api/v1/masters/${grantedPhoto.masterId}/avatar`)).status, 403);
  await sql`DELETE FROM organization_access_grants WHERE principal_organization_id = ${home.organization_id}
    AND principal_member_id = ${home.id} AND target_organization_id = ${target.id}`;
  assert.equal((await path(developerCookie, `/api/v1/masters/${grantedPhoto.masterId}/avatar`)).status, 404, 'Revoked grant must remove master photo access');
  assert.equal((await path(developerCookie, `/api/v1/members/${grantedPhoto.memberId}/avatar`)).status, 404);
  assert.equal((await path(developerCookie, `/clients/${client.id}`)).status, 404, 'Revoked grant removes client card access');
  assert.equal((await clientPage(developerCookie)).total, 1);
  for (const q of ['ЦЕНТР-101', 'Выезд выданной компании', '05.01.2030']) {
    const response = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(q)}`, { headers: { Cookie: developerCookie } });
    const results = (await response.json()).data.results;
    if (q === '05.01.2030') assert.deepEqual(results.map(item => item.id), [centerVisit.id], 'Revoking a grant must retain own-center visits');
    else assert.deepEqual(results, [], 'Revoked grant removes order and visit search access');
  }
  assert.equal((await contractPage()).total, 0);
  assert.equal((await path(developerCookie, `/contracts/${companyContract.id}`)).status, 404);
  assert.equal((await path(developerCookie, `/calendar?contract=${companyContract.id}&date=2030-01-05`)).status, 404);
  assert.equal((await path(developerCookie, `/api/v1/visits/${companyVisit.id}/dispatch-card`)).status, 404);
  const revokedCalendar = await fetch(`${baseUrl}/calendar?date=2030-01-05&view=list`, { headers: { Cookie: developerCookie } });
  const revokedCalendarHtml = await revokedCalendar.text();
  assert.doesNotMatch(revokedCalendarHtml, /Дополнительный выезд компании|Выезд выданной компании/);
  assert.match(revokedCalendarHtml, /Выезд центра для переноса/);
  assert.equal((await path(developerCookie, `/api/v1/visits/${centerVisit.id}/dispatch-card`)).status, 200);
  const revokedContractSearch = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('Янтарный договор центра')}`, { headers: { Cookie: developerCookie } });
  assert.deepEqual((await revokedContractSearch.json()).data.results, []);
  const revokedSearch = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent('Клиент другого контура')}`, { headers: { Cookie: developerCookie } });
  assert.deepEqual((await revokedSearch.json()).data.results, []);
  console.log("Business role browser access passed for seven roles, full overdue task counts in center/company dashboards, granted orders, 521 contracts with full search/pagination, contract documents/history/calendar/dispatch and a 75-visit center calendar with pagination and own-only rescheduling at four widths, paginated clients/search/private notes at three widths without switching company, sites and documents, shared member/master photos with replacement and revoked grants, and principal role retention.");
} catch (error) {
  const failedPage = browser?.contexts()[0]?.pages()[0];
  if (failedPage) {
    await failedPage.screenshot({ path: 'artifacts/business-roles/failure.png', fullPage: true }).catch(() => {});
    console.error(JSON.stringify(await failedPage.evaluate(() => ({ url: location.pathname + location.search, width: innerWidth,
      links: [...document.querySelectorAll('a')].filter(a => a.textContent.includes('Выезд выданной компании')).map(a => ({ width: a.getBoundingClientRect().width, height: a.getBoundingClientRect().height, display: getComputedStyle(a).display })) }))));
  }
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  await sql?.end();
  try { if (created) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
}
