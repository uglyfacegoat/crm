import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) {
  throw new Error("Run this database scenario through its isolated npm test command.");
}
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to an isolated PostgreSQL instance with CREATEDB privileges.");

async function databaseFixture(t) {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
  const name = `crm_migration_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  t.after(async () => {
    await sql.end();
    try {
      await admin`DROP DATABASE ${admin(name)}`;
    } finally {
      await admin.end();
    }
  });
  return { sql, databaseUrl };
}

async function migrationDirectory(t, files) {
  const directory = await mkdtemp(join(tmpdir(), "crm-migrations-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [name, source] of Object.entries(files)) {
    await writeFile(join(directory, name), source);
  }
  return directory;
}

const quiet = () => {};

test("all application migrations install cleanly and repeated deployment changes nothing", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  const applied = [];
  await runMigrations({ databaseUrl, onApplied: (name) => applied.push(name) });
  const expected = (await readdir(resolve("db/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(applied, expected);
  const before = await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`;
  await runMigrations({ databaseUrl, onApplied: () => assert.fail("Second deployment must not rerun migrations") });
  assert.deepEqual(await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`, before);
});

test("push choices survive deletion of an expired login session", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  await runMigrations({ databaseUrl, onApplied: quiet });
  const [organization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Push preference fixture', 'Europe/Moscow') RETURNING id`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Push tester', 'push-tester@fixture.invalid', 'manager') RETURNING id`;
  const [firstSession] = await sql`INSERT INTO auth_sessions
    (organization_id, member_id, token_hash, expires_at)
    VALUES (${organization.id}, ${member.id}, ${'a'.repeat(64)}, now() + interval '1 day') RETURNING id`;
  const endpoint = 'https://fcm.googleapis.com/fcm/send/fixture-device';
  await sql`INSERT INTO chat_push_subscriptions
    (endpoint, organization_id, member_id, session_id, p256dh, auth_secret, chat_enabled, events_enabled, events_enabled_at)
    VALUES (${endpoint}, ${organization.id}, ${member.id}, ${firstSession.id},
      ${'b'.repeat(44)}, ${'c'.repeat(16)}, true, true, now())`;
  await sql`DELETE FROM auth_sessions WHERE id = ${firstSession.id}`;
  const [retained] = await sql`SELECT session_id, chat_enabled, events_enabled
    FROM chat_push_subscriptions WHERE endpoint = ${endpoint}`;
  assert.deepEqual(retained, { session_id: null, chat_enabled: true, events_enabled: true });
});

test("business roles install with field-account linkage enforced by the database", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  await runMigrations({ databaseUrl, onApplied: quiet });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Role architecture fixture', 'Europe/Moscow') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${organization.id}, 'Field lead fixture', '+70000000111', '+70000000111', 'Moscow', 'Center') RETURNING id`;
  for (const role of ["deputy", "finance_controller", "sales_lead", "regional_director", "crm_coordinator", "tender_specialist"]) {
    const rows = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, ${`Role ${role}`}, ${`${role}@fixture.invalid`}, ${role}) RETURNING id`;
    assert.equal(rows.length, 1);
  }
  const foreman = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
    VALUES (${organization.id}, 'Field lead', 'foreman@fixture.invalid', 'foreman', ${master.id}) RETURNING id`;
  assert.equal(foreman.length, 1);
  await assert.rejects(sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Unlinked foreman', 'unlinked@fixture.invalid', 'foreman')`, { code: "23514" });
});

test("upgrade from the committed 049 baseline preserves existing business records", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  const baseline = "049_master_direct_chat.sql";
  const directory = await migrationDirectory(t, {});
  const files = (await readdir(resolve("db/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  assert.ok(files.includes(baseline));
  for (const name of files.filter((name) => name <= baseline)) {
    await cp(resolve("db/migrations", name), join(directory, name));
  }
  await runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Migration preservation test', 'Europe/Moscow') RETURNING id`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, primary_phone)
    VALUES (${organization.id}, 'Existing customer', '+79990000000') RETURNING *`;
  const before = await sql`SELECT * FROM schema_migrations ORDER BY name`;
  await runMigrations({ databaseUrl, onApplied: quiet });
  const [preserved] = await sql`SELECT * FROM clients WHERE id = ${client.id}`;
  assert.deepEqual(preserved, client);
  assert.deepEqual(await sql`SELECT * FROM schema_migrations WHERE name <= ${baseline} ORDER BY name`, before);
  assert.equal(Number((await sql`SELECT count(*) FROM schema_migrations`)[0].count), files.length);
  assert.ok((await sql`SELECT to_regclass('public.contract_relations') AS relation`)[0].relation);
  const [legacyImportTables] = await sql`SELECT
    to_regclass('public.import_jobs') AS jobs,
    to_regclass('public.import_job_issues') AS issues,
    to_regclass('public.import_record_links') AS links`;
  assert.deepEqual(legacyImportTables, { jobs: null, issues: null, links: null });
});

test("concurrent deployments serialize bootstrap and execute each migration exactly once", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  const directory = await migrationDirectory(t, {
    "001_records.sql": "CREATE TABLE migration_records (id integer PRIMARY KEY); SELECT pg_sleep(0.1);",
    "002_insert.sql": "INSERT INTO migration_records VALUES (1); SELECT pg_sleep(0.1);",
  });
  const deployments = await Promise.allSettled(Array.from({ length: 3 }, () => runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet })));
  for (const deployment of deployments) {
    if (deployment.status === "rejected") throw deployment.reason;
  }
  assert.equal(Number((await sql`SELECT count(*) FROM migration_records`)[0].count), 1);
  assert.equal(Number((await sql`SELECT count(*) FROM schema_migrations`)[0].count), 2);
});

test("failed migration rolls back both DDL and data and can be retried after correction", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  const directory = await migrationDirectory(t, {
    "001_records.sql": "CREATE TABLE migration_records (id integer PRIMARY KEY); INSERT INTO migration_records VALUES (1);",
    "002_failure.sql": "CREATE TABLE should_rollback (id integer); INSERT INTO migration_records VALUES (2); SELECT missing_column FROM migration_records;",
  });
  await assert.rejects(runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet }), { code: "42703" });
  assert.equal((await sql`SELECT to_regclass('public.should_rollback') AS relation`)[0].relation, null);
  assert.deepEqual(Array.from(await sql`SELECT id FROM migration_records`), [{ id: 1 }]);
  assert.equal(Number((await sql`SELECT count(*) FROM schema_migrations`)[0].count), 1);
  await writeFile(join(directory, "002_failure.sql"), "INSERT INTO migration_records VALUES (2);");
  await runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet });
  assert.equal(Number((await sql`SELECT count(*) FROM migration_records`)[0].count), 2);
});

test("modified, missing and reordered applied files fail before pending SQL executes", async (t) => {
  const { sql, databaseUrl } = await databaseFixture(t);
  const directory = await migrationDirectory(t, { "001_records.sql": "CREATE TABLE migration_records (id integer PRIMARY KEY);" });
  await runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet });
  await writeFile(join(directory, "002_pending.sql"), "INSERT INTO migration_records VALUES (1);");
  await writeFile(join(directory, "001_records.sql"), "SELECT 1;");
  await assert.rejects(runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet }), /has been modified/);
  await rm(join(directory, "001_records.sql"));
  await assert.rejects(runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet }), /history diverges/);
  await writeFile(join(directory, "001_records.sql"), "CREATE TABLE migration_records (id integer PRIMARY KEY);");
  await writeFile(join(directory, "000_inserted_late.sql"), "SELECT 1;");
  await assert.rejects(runMigrations({ databaseUrl, migrationsDirectory: directory, onApplied: quiet }), /history diverges/);
  assert.equal(Number((await sql`SELECT count(*) FROM migration_records`)[0].count), 0);
});
