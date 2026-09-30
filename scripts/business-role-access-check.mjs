import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password.ts";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error("Run through the isolated PostgreSQL fixture.");
const baseUrl = "http://127.0.0.1:3117";
const runtime = resolve(".next/standalone/server.js");
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
let sql; let server; let serverExit; let created = false;
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
  const [ungrantedClient] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${ungrantedCompany.id}, 'Скрытый клиент', 'legal_entity') RETURNING id`;
  const [ungrantedOrder] = await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${ungrantedCompany.id}, ${ungrantedClient.id}, 'СКРЫТ-101', 'new', 'RUB', 'Скрытый клиент', 'Объект не указан', 'Адрес не указан') RETURNING id`;
  const ungrantedDocument = await seedDocument(ungrantedCompany.id, ungrantedClient.id, ungrantedOrder.id, ungrantedMember.id, 'Скрытый документ');
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
  await cp(resolve(".next/static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
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
  const companyDashboard = await fetch(`${baseUrl}/`, { headers: { Cookie: companyCookie }, redirect: "manual" });
  assert.equal(companyDashboard.status, 200, `a new role must open a company dashboard: ${stderr}`);
  const companyDashboardHtml = (await companyDashboard.text()).replaceAll(/<!--.*?-->/g, "");
  assert.match(companyDashboardHtml, /Сегодня в работе/);
  assert.match(companyDashboardHtml, /510 просроченные задачи/);
  console.log("Business role browser access passed for seven roles, full overdue task counts in center/company dashboards, granted orders, sites and documents, and principal role retention.");
} finally {
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  await sql?.end();
  try { if (created) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
}
