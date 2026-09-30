import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl) throw new Error("Run through the isolated PostgreSQL fixture.");
const root = new URL("../src/", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root.href)) {
    if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, root).href, context);
    if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", root), { namedExports: { getDatabase: () => sql } });
const { listContracts, listContractPage, getContract, listContractHistory, updateContract, ContractNotFoundError } = await import("../src/server/contracts/repository.ts");
const { listVisits, getVisitDispatchCard, rescheduleVisit, VisitNotFoundError } = await import("../src/server/visits/repository.ts");
const { listMasterPage, getMasterDetail, updateMaster, MasterNotFoundError } = await import("../src/server/masters/repository.ts");
const { masterListQuerySchema } = await import("../src/lib/master-list.ts");
const { masterVisitHref } = await import("../src/lib/master-visit.ts");
const { contractListQuerySchema } = await import("../src/lib/contract-list.ts");
const { contractPickerQuerySchema, searchContractPicker } = await import("../src/server/contracts/option-picker.ts");

test("contract pickers find objects, masters and contracts beyond initial caps within the organization", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_contract_picker_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll(); hooks.deregister(); await sql.end();
    try { await admin`DROP DATABASE ${admin(databaseName)}`; } finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Contracts A', 'Europe/Moscow') RETURNING id`;
  const [other] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Contracts B', 'Europe/Moscow') RETURNING id`;
  const [person] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Contract editor', 'contract-editor@example.test', 'admin') RETURNING id`;
  const member = { organizationId: organization.id, memberId: person.id, role: "owner", permissionOverrides: {} };
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${organization.id}, 'Наш клиент', 'legal_entity') RETURNING id`;
  const [foreignClient] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${other.id}, 'Чужой клиент', 'legal_entity') RETURNING id`;
  await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    SELECT ${organization.id}, ${client.id}, 'Объект ' || lpad(n::text, 4, '0'), 'Office', 'Тестовый адрес ' || n
    FROM generate_series(1, 1001) n`;
  const [lastObject] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organization.id}, ${client.id}, 'Янтарный объект Ёж', 'Office', 'Янтарный адрес 1002') RETURNING id`;
  await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${other.id}, ${foreignClient.id}, 'Чужой объект Ёж', 'Office', 'Чужой адрес 1002')`;

  await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    SELECT ${organization.id}, 'Мастер ' || lpad(n::text, 4, '0'), '+7999' || lpad(n::text, 7, '0'),
      '+7999' || lpad(n::text, 7, '0'), 'Москва', 'Москва' FROM generate_series(1, 501) n`;
  const [lastMaster] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${organization.id}, 'Янтарный мастер Ёж', '+79998888888', '+79998888888', 'Москва', 'Москва') RETURNING id`;
  await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${other.id}, 'Чужой мастер Ёж', '+79997777777', '+79997777777', 'Москва', 'Москва')`;

  await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    SELECT ${organization.id}, ${client.id}, ${lastObject.id}, 'А-' || lpad(n::text, 4, '0'),
      'draft', '2026-01-01', '2026-12-31', 30 FROM generate_series(1, 501) n`;
  const [lastContract] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    VALUES (${organization.id}, ${client.id}, ${lastObject.id}, 'Янтарный договор Ёж', 'draft', '2027-01-01', '2027-12-31', 30) RETURNING id`;
  await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days)
    SELECT ${other.id}, ${foreignClient.id}, client_objects.id, 'Чужой договор Ёж', 'draft', '2026-01-01', '2026-12-31', 30
    FROM client_objects WHERE organization_id = ${other.id} LIMIT 1`;

  const masterDefaults = masterListQuerySchema.parse({});
  const masterIds = [];
  for (let page = 1; page <= 11; page++) {
    const result = await listMasterPage(member, { ...masterDefaults, page });
    assert.equal(result.total, 502); assert.equal(result.counts.all, 502);
    assert.ok(result.items.length <= 50); masterIds.push(...result.items.map(item => item.id));
  }
  assert.equal(new Set(masterIds).size, 502); assert.ok(masterIds.includes(lastMaster.id));
  assert.equal((await listMasterPage(member, { ...masterDefaults, page: 999 })).page, 11);
  assert.deepEqual((await listMasterPage(member, { ...masterDefaults, q: 'янтарный мастер еж' })).items.map(item => item.id), [lastMaster.id]);
  assert.equal((await listMasterPage(member, { ...masterDefaults, q: 'чужой' })).total, 0);
  await sql`UPDATE masters SET skills = ARRAY['Поздняя специализация'], service_zone = 'Поздняя зона', daily_capacity = 2, base_payment_minor = 125000 WHERE id = ${lastMaster.id}`;
  const masterFacets = await listMasterPage(member, masterDefaults);
  assert.ok(masterFacets.facets.skills.includes('Поздняя специализация'));
  assert.ok(masterFacets.facets.zones.includes('Поздняя зона'));
  assert.equal((await listMasterPage(member, { ...masterDefaults, skill: 'Поздняя специализация' })).total, 1);
  assert.equal((await listMasterPage(member, { ...masterDefaults, zone: 'Поздняя зона' })).total, 1);
  assert.equal((await listMasterPage(member, { ...masterDefaults, region: 'Несуществующий регион' })).facets.zones.length, 0);

  const initial = await listContracts(member);
  assert.equal(initial.objectOptions.length, 1000);
  assert.equal(initial.masterOptions.length, 500);
  assert.equal(initial.contracts.length, 50);
  assert.equal(initial.summary.total, 502);
  assert.ok(!initial.objectOptions.some((item) => item.id === lastObject.id));
  assert.ok(!initial.masterOptions.some((item) => item.id === lastMaster.id));
  assert.ok(!initial.contracts.some((item) => item.id === lastContract.id));

  for (const [type, id] of [["objects", lastObject.id], ["masters", lastMaster.id], ["contracts", lastContract.id]]) {
    const first = await searchContractPicker(member, contractPickerQuerySchema.parse({ type }));
    assert.equal(first.items.length, 20);
    assert.equal(first.hasMore, true);
    const found = await searchContractPicker(member, contractPickerQuerySchema.parse({ type, q: "еж" }));
    assert.deepEqual(found.items.map((item) => item.id), [id]);
    assert.equal((await searchContractPicker(member, contractPickerQuerySchema.parse({ type, q: "чужой" }))).items.length, 0);
  }
  const object = await searchContractPicker(member, contractPickerQuerySchema.parse({ type: "objects", q: "янтарный" }));
  assert.equal(object.items[0].clientId, client.id);
  const defaults = contractListQuerySchema.parse({});
  const allIds = [];
  for (let page = 1; page <= 11; page += 1) {
    const result = await listContractPage(member, { ...defaults, page });
    assert.equal(result.total, 502);
    assert.ok(result.items.length <= 50);
    allIds.push(...result.items.map(item => item.id));
  }
  assert.equal(allIds.length, 502);
  assert.equal(new Set(allIds).size, 502);
  assert.ok(allIds.includes(lastContract.id));
  assert.deepEqual((await listContractPage(member, { ...defaults, q: "янтарный договор" })).items.map(item => item.id), [lastContract.id]);
  assert.equal((await listContractPage(member, { ...defaults, page: 999 })).page, 11);
  assert.equal((await listContractPage(member, { ...defaults, dateFrom: "2027-01-01", dateTo: "2027-12-31" })).total, 1);
  assert.equal((await listContractPage(member, { ...defaults, quick: "active" })).total, 0);
  assert.equal((await listContractPage(member, { ...defaults, sort: "newest" })).items[0].id, lastContract.id);
  const [source] = await sql`SELECT id FROM contracts WHERE organization_id = ${organization.id} AND contract_number = 'А-0001'`;
  await sql`INSERT INTO contract_relations (organization_id, contract_a_id, contract_b_id, relation_type, created_by)
    VALUES (${organization.id}, ${source.id < lastContract.id ? source.id : lastContract.id},
      ${source.id < lastContract.id ? lastContract.id : source.id}, 'related', ${person.id})`;
  assert.deepEqual((await searchContractPicker(member, contractPickerQuerySchema.parse({ type: "contracts", sourceContractId: source.id, q: "янтарный" }))).items, []);
  await sql`INSERT INTO contract_schedule_rules (organization_id, contract_id, frequency_unit, frequency_interval,
    local_time, starts_on, ends_on, default_master_id)
    VALUES (${organization.id}, ${lastContract.id}, 'month', 1, '10:15', '2027-01-01', '2027-12-31', ${lastMaster.id})`;
  await sql`INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, after_state, reason)
    VALUES (${organization.id}, ${lastContract.id}, ${person.id}, 'created', '{}'::jsonb, 'История из центра')`;
  const byMaster = await listContractPage(member, { ...defaults, master: lastMaster.id, schedule: "scheduled" });
  assert.deepEqual(byMaster.items.map(item => item.id), [lastContract.id]);
  assert.equal(byMaster.summary.scheduledContracts, 1);
  assert.equal((await listContractPage(member, { ...defaults, schedule: "unscheduled" })).total, 501);

  const [center] = await sql`INSERT INTO organizations (name, timezone, organization_kind) VALUES ('Центр договоров', 'Europe/Moscow', 'center') RETURNING id`;
  await sql`UPDATE organizations SET organization_kind = 'company', parent_organization_id = ${center.id} WHERE id = ${organization.id}`;
  const [principal] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${center.id}, 'Center contract reader', 'center@contracts.invalid', 'admin') RETURNING id`;
  const [session] = await sql`INSERT INTO auth_sessions (organization_id, member_id, token_hash, expires_at)
    VALUES (${center.id}, ${principal.id}, ${'b'.repeat(64)}, now() + interval '1 day') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${center.id}, ${principal.id}, ${organization.id}, ${person.id})`;
  const centerMember = { ...member, organizationId: center.id, memberId: principal.id, sessionId: session.id };
  await sql`INSERT INTO service_visits (organization_id, contract_id, object_id, scheduled_start_at, scheduled_end_at,
      status, cancellation_reason, client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by)
    SELECT ${organization.id}, ${lastContract.id}, ${lastObject.id}, '2027-01-01T00:00:00Z'::timestamptz + n * interval '1 hour',
      '2027-01-01T00:00:00Z'::timestamptz + (n + 1) * interval '1 hour', 'planned', NULL, 'Наш клиент', 'Янтарный объект Ёж', 'Янтарный адрес 1002',
      ${person.id}, ${person.id} FROM generate_series(1, 505) n`;
  await sql`INSERT INTO service_visits (organization_id, contract_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at,
    status, cancellation_reason, client_name_snapshot, object_name_snapshot, object_address_snapshot, created_by, updated_by)
    SELECT ${organization.id}, ${lastContract.id}, ${lastObject.id}, ${lastMaster.id},
      (((now() AT TIME ZONE 'Europe/Moscow')::date + time '08:00') AT TIME ZONE 'Europe/Moscow') + n * interval '1 hour',
      (((now() AT TIME ZONE 'Europe/Moscow')::date + time '09:00') AT TIME ZONE 'Europe/Moscow') + n * interval '1 hour',
      CASE WHEN n = 4 THEN 'cancelled' ELSE 'planned' END, CASE WHEN n = 4 THEN 'Отменено для теста' ELSE NULL END,
      'Наш клиент', 'Маршрут по договору', 'Адрес маршрута', ${person.id}, ${person.id} FROM generate_series(1, 5) n`;
  const [completedRoute] = await sql`SELECT id FROM service_visits WHERE assigned_master_id = ${lastMaster.id} ORDER BY scheduled_start_at DESC LIMIT 1`;
  const [actOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${organization.id}, ${client.id}, ${lastObject.id}, 'TEST-ACT', 'new', 'RUB', 'Наш клиент', 'Объект', 'Адрес') RETURNING id`;
  const [act] = await sql`INSERT INTO documents (id, organization_id, client_id, object_id, order_id, contract_id, visit_id, title, category, created_by)
    VALUES (${randomUUID()}, ${organization.id}, ${client.id}, ${lastObject.id}, ${actOrder.id}, ${lastContract.id}, ${completedRoute.id}, 'Акт завершения теста', 'act', ${person.id}) RETURNING id`;
  await sql`UPDATE service_visits SET status = 'completed', completion_document_id = ${act.id}, completion_notes = 'Проверено',
    completed_at = now(), completed_by = ${person.id} WHERE id = ${completedRoute.id}`;
  const centerMasters = await listMasterPage(centerMember, { ...masterDefaults, skill: 'Поздняя специализация' });
  assert.equal(centerMasters.total, 1); assert.equal(centerMasters.counts.all, 502); assert.equal(centerMasters.counts.overloaded, 1);
  const loadedMaster = centerMasters.items[0];
  assert.equal(loadedMaster.todayVisitCount, 3); assert.equal(loadedMaster.todayVisits.length, 2);
  assert.equal(loadedMaster.loadPercent, 150); assert.equal(loadedMaster.organizationId, organization.id);
  assert.ok(loadedMaster.todayVisits.every(item => item.orderId === null && item.contractId === lastContract.id && masterVisitHref(item).startsWith('/calendar?')));
  const masterDetail = await getMasterDetail(centerMember, lastMaster.id);
  assert.equal(masterDetail.todayVisitCount, 3); assert.equal(masterDetail.totalVisits, 5); assert.equal(masterDetail.completedVisits, 1);
  assert.equal(masterDetail.recentVisits.length, 5); assert.ok(masterDetail.recentVisits.every(item => item.contractId === lastContract.id));
  assert.equal(masterDetail.basePaymentMinor, 125000);
  const noFinance = await getMasterDetail({ ...centerMember, role: 'deputy', permissionOverrides: { 'finance.read': false } }, lastMaster.id);
  assert.equal(noFinance.basePaymentMinor, undefined); assert.equal(noFinance.paidMinor, undefined);
  await assert.rejects(updateMaster(centerMember, { masterId: lastMaster.id, expectedVersion: 1 }), MasterNotFoundError);
  assert.equal((await getMasterDetail(member, lastMaster.id)).version, 1);
  const calendar = await listVisits({ ...centerMember, organizationId: organization.id }, '2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z', null, lastContract.id);
  assert.equal(calendar.length, 505);
  assert.equal(new Set(calendar.map(item => item.id)).size, 505);
  assert.ok(calendar.every(item => item.contractId === lastContract.id));
  assert.equal((await getVisitDispatchCard(centerMember, calendar[0].id)).client, 'Наш клиент');
  const wholeCalendar = await listVisits(centerMember, '2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z', null, null, true);
  assert.equal(wholeCalendar.length, 505, 'The center calendar must include the whole granted range beyond 500');
  assert.ok(wholeCalendar.every(item => item.organizationId === organization.id && item.organizationName === 'Contracts A'));
  assert.equal((await listVisits(centerMember, '2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z')).length, 0, 'Dashboard aggregation keeps its per-organization scope');
  await assert.rejects(rescheduleVisit(centerMember, { visitId: calendar[0].id, expectedVersion: 1, localDate: '2027-01-10', localTime: '10:00', rescheduleReason: 'Denied company write', arrivalMode: 'fixed' }), VisitNotFoundError);

  assert.equal((await listContractPage(centerMember, defaults)).total, 502);
  assert.equal((await getContract(centerMember, lastContract.id)).organizationId, organization.id);
  assert.equal((await listContractHistory(centerMember, lastContract.id))[0].reason, 'История из центра');
  assert.equal((await searchContractPicker(centerMember, contractPickerQuerySchema.parse({ type: "filter-masters", q: "еж" }))).items[0].id, lastMaster.id);
  assert.equal((await searchContractPicker(centerMember, contractPickerQuerySchema.parse({ type: "masters", q: "еж" }))).items.length, 0);
  const edit = { contractId: lastContract.id, expectedVersion: 1, contractNumber: 'Недопустимая правка', status: 'draft',
    startsOn: '2027-01-01', endsOn: '2027-12-31', renewalNoticeDays: 30, notes: null, reason: null };
  await assert.rejects(updateContract(centerMember, edit), ContractNotFoundError);
  assert.equal((await getContract(member, lastContract.id)).version, 1);
  const reader = { ...centerMember, role: 'deputy', permissionOverrides: { 'contracts.write': false } };
  assert.equal((await searchContractPicker(reader, contractPickerQuerySchema.parse({ type: "filter-masters", q: "еж" }))).items.length, 1);
  await assert.rejects(searchContractPicker(reader, contractPickerQuerySchema.parse({ type: "masters" })));
  await sql`DELETE FROM organization_access_grants WHERE principal_organization_id = ${center.id}`;
  assert.equal((await listMasterPage(centerMember, masterDefaults)).total, 0);
  await assert.rejects(getMasterDetail(centerMember, lastMaster.id), MasterNotFoundError);
  assert.equal((await listContractPage(centerMember, defaults)).total, 0);
  assert.equal((await listVisits(centerMember, '2027-01-01T00:00:00Z', '2027-04-01T00:00:00Z', null, null, true)).length, 0, 'Revoked company disappears from the general calendar');
  await assert.rejects(getVisitDispatchCard(centerMember, calendar[0].id), VisitNotFoundError);
  await assert.rejects(getContract(centerMember, lastContract.id), ContractNotFoundError);
  await assert.rejects(listContractHistory(centerMember, lastContract.id), ContractNotFoundError);
  assert.equal((await searchContractPicker(centerMember, contractPickerQuerySchema.parse({ type: "filter-masters", q: "еж" }))).items.length, 0);
  const [unchanged] = await sql`SELECT active_organization_id FROM auth_sessions WHERE id = ${session.id}`;
  assert.equal(unchanged.active_organization_id, null);
  await assert.rejects(searchContractPicker({ ...member, role: "master" }, contractPickerQuerySchema.parse({ type: "objects" })));
});
