import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { mock, test } from 'node:test';
import postgres from 'postgres';
import { runMigrations } from './migrate.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error('Run through the isolated PostgreSQL fixture.');
const root = new URL('../src/', import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith('@/')) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? '' : '.ts'}`, root).href, context);
    if (specifier.startsWith('.') && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
let currentMember;
mock.module('server-only', { namedExports: {} });
mock.module(new URL('server/database.ts', root), { namedExports: { getDatabase: () => sql } });
mock.module(new URL('server/auth/config.ts', root), { namedExports: { getAuthMode: () => 'required' } });
mock.module(new URL('server/auth/session.ts', root), { namedExports: { getCurrentSession: async () => currentMember } });
mock.module(new URL('server/request-limits/repository.ts', root), { namedExports: { consumeRequestLimit: async () => ({ allowed: true }) } });
const { getMemberActivityReport, recordMemberScreenActivity } = await import('../src/server/members/activity.ts');
const { GET } = await import('../src/app/api/v1/settings/activity/route.ts');
const { activityReportQuerySchema } = await import('../src/lib/member-activity-report.ts');
const { screenForPath } = await import('../src/lib/member-activity.ts');

test('activity report pages employees but keeps complete timezone-aware team totals and private details', async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_activity_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Activity dates', 'Pacific/Kiritimati') RETURNING id`;
  const [foreignOrg] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Foreign activity', 'Europe/Moscow') RETURNING id`;
  const [owner] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${org.id}, 'Owner', 'owner@activity.invalid', 'admin') RETURNING id`;
  const [foreign] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${foreignOrg.id}, 'Foreign employee', 'foreign@activity.invalid', 'crm_coordinator') RETURNING id`;
  const staff = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    SELECT ${org.id}, 'Activity employee ' || lpad(n::text, 3, '0'), 'employee-' || n || '@activity.invalid', 'crm_coordinator'
    FROM generate_series(1, 67) n RETURNING id, display_name`;
  currentMember = { sessionId: null, organizationId: org.id, organizationName: 'Activity dates', memberId: owner.id,
    displayName: 'Owner', email: 'owner@activity.invalid', role: 'owner', masterId: null, permissionOverrides: {} };
  await sql`INSERT INTO member_screen_activity (organization_id, member_id, bucket_start, screen_key, source)
    SELECT ${org.id}, members.id, now() - interval '1 hour', 'orders', 'measured' FROM organization_members members WHERE members.id IN ${sql(staff.map(item => item.id))}`;
  const late = staff.find(item => item.display_name === 'Activity employee 067');
  await sql`INSERT INTO member_screen_activity (organization_id, member_id, bucket_start, screen_key, source)
    VALUES (${org.id}, ${late.id}, now() - interval '12 days', 'mail', 'demo'),
      (${org.id}, ${late.id}, ((now() AT TIME ZONE 'Pacific/Kiritimati')::date - 6)::timestamp AT TIME ZONE 'Pacific/Kiritimati', 'services', 'measured'),
      (${org.id}, ${late.id}, (((now() AT TIME ZONE 'Pacific/Kiritimati')::date - 6)::timestamp AT TIME ZONE 'Pacific/Kiritimati') - interval '30 seconds', 'chat', 'measured'),
      (${org.id}, ${late.id}, now() - interval '40 days', 'orders', 'measured'),
      (${org.id}, ${late.id}, now() - interval '2 hours', 'unregistered_screen', 'measured'),
      (${foreignOrg.id}, ${foreign.id}, now(), 'orders', 'measured')`;
  const defaults = activityReportQuerySchema.parse({});
  const report = await getMemberActivityReport(currentMember, defaults);
  assert.equal(report.summary.memberCount, 68); assert.equal(report.summary.activeCount, 67);
  assert.equal(report.summary.totalSeconds, 67 * 30 + 90); assert.equal(report.summary.demoSeconds, 30);
  assert.equal(report.timeZone, 'Pacific/Kiritimati'); assert.equal(report.days.length, 30);
  assert.equal(report.members.items.length, 30); assert.equal(report.members.total, 68);
  assert.equal(report.selected.member.id, late.id);
  assert.deepEqual(new Set(report.selected.screens.map(item => item.key)), new Set(['orders', 'mail', 'services', 'chat']));
  const seen = new Set();
  for (let page = 1; page <= 3; page++) {
    const part = await getMemberActivityReport(currentMember, { ...defaults, page });
    assert.deepEqual(part.summary, report.summary);
    for (const item of part.members.items) { assert(!seen.has(item.member.id)); seen.add(item.member.id); }
  }
  assert.equal(seen.size, 68); assert(!seen.has(foreign.id));
  const searched = await getMemberActivityReport(currentMember, { ...defaults, q: 'Activity employee 001' });
  assert.equal(searched.members.total, 1); assert.deepEqual(searched.summary, report.summary);
  const roleSearch = await getMemberActivityReport(currentMember, { ...defaults, q: 'Координатор CRM' });
  assert.equal(roleSearch.members.total, 67);
  const seven = await getMemberActivityReport(currentMember, { ...defaults, period: 7, memberId: late.id });
  assert.equal(seven.days.length, 7); assert.equal(seven.selected.seconds, 60); assert.equal(seven.selected.demoSeconds, 0);
  assert.equal(seven.summary.totalSeconds, 67 * 30 + 30);
  const [today] = await sql`SELECT ((now() AT TIME ZONE 'Pacific/Kiritimati')::date)::text AS day`;
  assert.equal(seven.days.at(-1).date, today.day);
  const empty = await getMemberActivityReport(currentMember, { ...defaults, q: 'Not present' });
  assert.equal(empty.members.total, 0); assert.equal(empty.selected, null); assert.deepEqual(empty.summary, report.summary);
  await assert.rejects(() => getMemberActivityReport(currentMember, { ...defaults, memberId: foreign.id }), /not found/);
  const request = params => new Request(`http://fixture.invalid/api/v1/settings/activity?${new URLSearchParams(params)}`);
  const api = await GET(request({ period: '7', memberId: late.id }));
  assert.equal(api.status, 200); assert.match(api.headers.get('cache-control'), /private, no-store/);
  assert.equal((await api.json()).data.selected.seconds, 60);
  assert.equal((await GET(request({ memberId: foreign.id }))).status, 404);
  for (const params of [{ period: '3' }, { page: '0' }, { memberId: 'invalid' }, { q: 'x'.repeat(101) }]) assert.equal((await GET(request(params))).status, 400);
  await recordMemberScreenActivity(currentMember, 'services');
  await recordMemberScreenActivity(currentMember, 'mail');
  assert.equal(Number((await sql`SELECT count(*) FROM member_screen_activity WHERE member_id = ${owner.id}`)[0].count), 1);
  currentMember = { ...currentMember, role: 'crm_coordinator' };
  assert.equal((await GET(request({}))).status, 403);
  currentMember = null;
  assert.equal((await GET(request({}))).status, 401);
  assert.equal(screenForPath('/mail'), 'mail'); assert.equal(screenForPath('/services'), 'services'); assert.equal(screenForPath('/companies'), 'companies');
});
