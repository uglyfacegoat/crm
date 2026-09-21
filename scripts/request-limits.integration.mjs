import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to an isolated PostgreSQL instance with CREATEDB privileges.");

const repositoryUrl = new URL("../src/server/request-limits/repository.ts", import.meta.url);
const databaseUrl = new URL("../src/server/database.ts", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === repositoryUrl.href && specifier === "@/server/database") {
      return nextResolve(databaseUrl.href, context);
    }
    return nextResolve(specifier, context);
  },
});
let connections;
let connectionIndex = 0;
mock.module("server-only", { namedExports: {} });
mock.module(databaseUrl, { namedExports: {
  getDatabase: () => connections[connectionIndex++ % connections.length],
} });
const { consumeRequestLimit, requestLimitPolicies } = await import(repositoryUrl.href);
const policy = requestLimitPolicies.global_search;

test("request budgets use shared PostgreSQL state without crossing tenant boundaries", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_limits_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 5 });
  const replica = postgres(url.toString(), { max: 5 });
  connections = [sql, replica];
  t.after(async () => {
    mock.restoreAll();
    hooks.deregister();
    await Promise.all([sql.end(), replica.end()]);
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  async function company() {
    const [organization] = await sql`INSERT INTO organizations (name, timezone)
      VALUES ('Request limit test', 'Europe/Moscow') RETURNING id`;
    const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, 'Test member', 'member@example.invalid', 'admin') RETURNING id`;
    return { organizationId: organization.id, memberId: member.id };
  }

  await t.test("parallel calls across two connection pools cannot exceed the member limit", async () => {
    const member = await company();
    await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
      VALUES (${member.organizationId}, ${member.memberId}, 'global_search', ${policy.member - 20})`;
    const results = await Promise.all(Array.from({ length: 40 }, () => consumeRequestLimit(member, "global_search")));
    assert.equal(results.filter((result) => result.allowed).length, 20);
    assert.ok(results.every((result) => result.retryAfterSeconds >= 1 && result.retryAfterSeconds <= policy.windowSeconds));
    const rows = await sql`SELECT member_id, request_count FROM request_rate_limits WHERE organization_id = ${member.organizationId}`;
    assert.equal(rows.find((row) => row.member_id === null).request_count, 20, "Denied members must not exhaust the company budget");
    assert.equal(rows.find((row) => row.member_id === member.memberId).request_count, policy.member + 1);
  });

  await t.test("organization budget is shared across members but isolated from another company", async () => {
    const member = await company();
    const [colleague] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${member.organizationId}, 'Test colleague', 'colleague@example.invalid', 'admin') RETURNING id`;
    await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
      VALUES (${member.organizationId}, NULL, 'global_search', ${policy.organization - 5})`;
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) => consumeRequestLimit({
      ...member, memberId: index % 2 ? colleague.id : member.memberId,
    }, "global_search")));
    assert.equal(results.filter((result) => result.allowed).length, 5);
    const otherCompany = await company();
    assert.equal((await consumeRequestLimit(otherCompany, "global_search")).allowed, true);
    const [count] = await sql`SELECT count(*)::integer AS total FROM request_rate_limits
      WHERE organization_id = ${member.organizationId} AND member_id IS NULL`;
    assert.equal(count.total, 1, "NULL organization scope must have one unique bucket");
  });

  await t.test("expired windows recover using database time and reuse the existing rows", async () => {
    const member = await company();
    assert.equal((await consumeRequestLimit(member, "global_search")).allowed, true);
    await sql`UPDATE request_rate_limits SET request_count = ${policy.organization + 1},
      window_started_at = now() - interval '61 seconds' WHERE organization_id = ${member.organizationId}`;
    assert.equal((await consumeRequestLimit(member, "global_search")).allowed, true);
    const rows = await sql`SELECT request_count FROM request_rate_limits WHERE organization_id = ${member.organizationId}`;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.request_count === 1));
  });

  for (const operation of ["chat_message", "chat_upload", "chat_download"]) {
    await t.test(`${operation} budgets are concurrent and do not consume search capacity`, async () => {
      const member = await company();
      const limits = requestLimitPolicies[operation];
      await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
        VALUES (${member.organizationId}, ${member.memberId}, ${operation}, ${limits.member - 2}),
          (${member.organizationId}, NULL, ${operation}, ${limits.organization - 1})`;
      const results = await Promise.all(Array.from({ length: 3 }, () => consumeRequestLimit(member, operation)));
      assert.equal(results.filter((result) => result.allowed).length, 1);
      assert.equal((await consumeRequestLimit(member, "global_search")).allowed, true);
    });
  }

  await t.test("foreign keys reject forged member/company combinations and remove obsolete member budgets", async () => {
    const member = await company();
    const other = await company();
    await assert.rejects(consumeRequestLimit({ ...member, memberId: other.memberId }, "global_search"), { code: "23503" });
    await consumeRequestLimit(member, "global_search");
    await sql`DELETE FROM organization_members WHERE id = ${member.memberId}`;
    const rows = await sql`SELECT member_id FROM request_rate_limits WHERE organization_id = ${member.organizationId}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].member_id, null);
  });

  await t.test("storage failures reject the operation instead of granting an unlimited budget", async () => {
    const member = await company();
    const readOnly = postgres(url.toString(), { max: 1, connection: { default_transaction_read_only: "on" } });
    connections = [readOnly];
    try { await assert.rejects(consumeRequestLimit(member, "global_search"), { code: "25006" }); }
    finally { connections = [sql, replica]; await readOnly.end(); }
  });
});
