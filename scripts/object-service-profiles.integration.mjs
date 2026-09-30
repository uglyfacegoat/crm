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
mock.module('server-only', { namedExports: {} });
mock.module(new URL('server/database.ts', root), { namedExports: { getDatabase: () => sql } });
const { listObjectServiceProfiles, searchObjectServiceProfiles, objectProfileQuerySchema, saveObjectServiceProfile, ObjectServiceConflictError, ObjectServiceReferenceError } = await import('../src/server/catalog/object-service-profiles.ts');
const { objectServiceProfileSchema } = await import('../src/server/catalog/profile-schemas.ts');

test('object-specific service rates retain area, frequency, exact prices and tenant isolation', async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_services_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  async function fixture(organizationName, email) {
    const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES (${organizationName}, 'Europe/Moscow') RETURNING id`;
    const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Owner', ${email}, 'admin') RETURNING id`;
    const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${org.id}, 'Озон') RETURNING id`;
    const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address, area_square_meters)
      VALUES (${org.id}, ${client.id}, 'Истра', 'Склад', 'Московская область, Истра', 24198.87) RETURNING id`;
    return { member: { sessionId: null, organizationId: org.id, organizationName, memberId: person.id, displayName: 'Owner', email, role: 'admin', masterId: null, permissionOverrides: {} }, object };
  }
  const a = await fixture('Services A', 'a@services.invalid');
  const b = await fixture('Services B', 'b@services.invalid');
  const [catalog] = await sql`INSERT INTO catalog_items (organization_id, kind, name, unit, price_mode)
    VALUES (${a.member.organizationId}, 'service', 'Дезинфекция', 'м²', 'variable') RETURNING id`;
  const input = objectServiceProfileSchema.parse({ organizationId: a.member.organizationId, objectId: a.object.id, expectedVersion: 0,
    areaSquareMeters: '24198,87', visitsPerMonth: 2, serviceSchedule: 'Первая и третья неделя', contractTotal: '18391,14', notes: '',
    rates: [{ catalogItemId: catalog.id, name: 'Дезинфекция по договору', lineKind: 'contract', billingBasis: 'area', quantity: '', unitPrice: '0,07' },
      { catalogItemId: null, name: 'Ловушки', lineKind: 'request', billingBasis: 'quantity', quantity: '12', unitPrice: '0,30' }] });
  await saveObjectServiceProfile(a.member, input);
  const record = (await listObjectServiceProfiles(a.member)).find((profile) => profile.objectId === a.object.id);
  assert.equal(record.version, 1);
  assert.equal(record.visitsPerMonth, 2);
  assert.equal(record.contractTotalMinor, 1839114);
  assert.equal(record.rates[0].unitPriceMinor, 7);
  assert.equal(record.rates[1].unitPriceMinor, 30);
  assert.equal(record.rates[1].lineKind, 'request');
  assert.equal((await listObjectServiceProfiles(b.member))[0].rates.length, 0);
  await assert.rejects(saveObjectServiceProfile(a.member, input), ObjectServiceConflictError);
  await assert.rejects(saveObjectServiceProfile(b.member, { ...input, organizationId: b.member.organizationId, objectId: a.object.id }), ObjectServiceReferenceError);
  await saveObjectServiceProfile(a.member, { ...input, expectedVersion: 1, visitsPerMonth: 1, rates: [] });
  assert.equal((await listObjectServiceProfiles(a.member))[0].rates.length, 0);
  const [client] = await sql`SELECT client_id AS id FROM client_objects WHERE id = ${a.object.id}`;
  await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    SELECT ${a.member.organizationId}, ${client.id}, 'А-объект ' || lpad(n::text, 4, '0'), 'Склад', 'Адрес ' || n::text
    FROM generate_series(1, 1001) n`;
  const [target] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${a.member.organizationId}, ${client.id}, 'Янтарный объект Ёж', 'Склад', 'Янтарный адрес') RETURNING id`;
  assert.equal((await listObjectServiceProfiles(a.member)).some((profile) => profile.objectId === target.id), false);
  const query = (value) => objectProfileQuerySchema.parse(value);
  const first = await searchObjectServiceProfiles([a.member], query({}));
  const second = await searchObjectServiceProfiles([a.member], query({ page: 1 }));
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 50);
  assert.equal(first.hasMore, true);
  assert.equal(first.configuredCount, 1);
  assert.notEqual(first.items.at(-1).objectId, second.items[0].objectId);
  assert.deepEqual((await searchObjectServiceProfiles([a.member], query({ q: 'Янтарный объект Ёж' }))).items.map((profile) => profile.objectId), [target.id]);
  assert.deepEqual((await searchObjectServiceProfiles([a.member], query({ id: target.id }))).items.map((profile) => profile.objectId), [target.id]);
  assert.equal((await searchObjectServiceProfiles([a.member], query({ id: b.object.id }))).items.length, 0);
  assert.deepEqual((await searchObjectServiceProfiles([a.member, b.member], query({ q: 'Истра' }))).items.map((profile) => profile.organizationId).sort(), [a.member.organizationId, b.member.organizationId].sort());
  await assert.rejects(searchObjectServiceProfiles([{ ...a.member, permissionOverrides: { 'orders.read': false } }], query({})));
});
