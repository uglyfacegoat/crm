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
mock.module(new URL('server/auth/session.ts', root), { namedExports: { requireOfficeSession: async () => currentMember } });
const { canAccessNoteTarget, listPersonalNotes, listPersonalNoteTemplates, searchNoteDestinations } = await import('../src/server/personal-notes/repository.ts');
const { savePersonalNoteAction, deletePersonalNoteAction, transferPersonalNoteAction,
  savePersonalNoteTemplateAction, deletePersonalNoteTemplateAction } = await import('../src/app/(workspace)/personal-note-actions.ts');

test('personal notes stay private, persist without a date key, and search scoped destinations', async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_notes_${randomUUID().replaceAll('-', '')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl); url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await sql.end(); try { await admin`DROP DATABASE ${admin(name)}`; } finally { await admin.end(); } });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [org] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Notes Test', 'Europe/Moscow') RETURNING id`;
  const [otherOrg] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Notes Other', 'Europe/Moscow') RETURNING id`;
  const [author] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Author', 'author@notes.invalid', 'admin') RETURNING id`;
  const [colleague] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Colleague', 'colleague@notes.invalid', 'admin') RETURNING id`;
  const [liza] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${org.id}, 'Лиза', 'liza@notes.invalid', 'admin') RETURNING id`;
  const member = (id) => ({ sessionId: null, organizationId: org.id, organizationName: 'Notes Test', memberId: id, displayName: 'Test', email: 'test@notes.invalid', role: 'admin', masterId: null, permissionOverrides: {} });
  const dashboard = { kind: 'dashboard', organizationId: null, id: null };
  await sql`INSERT INTO personal_notes (owner_organization_id, owner_member_id, target_kind, title, body) VALUES (${org.id}, ${author.id}, 'dashboard', 'Plan', 'Keep this tomorrow')`;
  assert.equal((await listPersonalNotes(member(author.id), dashboard)).length, 1);
  assert.equal((await listPersonalNotes(member(colleague.id), dashboard)).length, 0);
  assert.deepEqual(await listPersonalNoteTemplates(member(author.id)), []);
  assert.deepEqual(await listPersonalNoteTemplates(member(colleague.id)), []);
  const lizaTemplates = await listPersonalNoteTemplates(member(liza.id));
  assert.equal(lizaTemplates.length, 1);
  assert.equal(lizaTemplates[0].kind, 'liza_order');
  currentMember = member(liza.id);
  await savePersonalNoteTemplateAction({ id: lizaTemplates[0].id, name: 'Личный вариант',
    body: 'Название объекта: {{object}}\nПлощадь объекта: 100\nНаименование услуг: Дезинфекция\nЦена за кВ.м.: 2\nОбщий чек: 200\nОбслуживание: два раза в месяц' });
  assert.equal((await listPersonalNoteTemplates(member(liza.id)))[0].kind, 'liza_order');
  assert.equal((await listPersonalNoteTemplates(member(liza.id)))[0].name, 'Личный вариант');
  assert.deepEqual(await listPersonalNoteTemplates(member(author.id)), []);
  currentMember = member(author.id);
  await assert.rejects(() => savePersonalNoteTemplateAction({ id: lizaTemplates[0].id,
    name: 'Чужое изменение', body: 'Недопустимо' }), /Шаблон не найден/);
  assert.equal((await listPersonalNoteTemplates(member(liza.id)))[0].name, 'Личный вариант');
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${org.id}, 'Клиент заметки') RETURNING id`;
  const [otherClient] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${otherOrg.id}, 'Чужой клиент') RETURNING id`;
  assert.equal(await canAccessNoteTarget(member(author.id), { kind: 'client', organizationId: org.id, id: client.id }), true);
  assert.equal(await canAccessNoteTarget(member(author.id), { kind: 'client', organizationId: otherOrg.id, id: otherClient.id }), false);
  const destinations = await searchNoteDestinations(member(author.id), 'Клиент заметки');
  assert(destinations.items.some((item) => item.kind === 'client' && item.id === client.id));
  assert(!destinations.items.some((item) => item.id === otherClient.id));
  // No silent first-20 cutoff, stable pages, and search beyond recent records.
  await sql`INSERT INTO clients (organization_id, legal_name, updated_at)
    SELECT ${org.id}, 'Большая база ' || n, now() - n * interval '1 day' FROM generate_series(1, 67) n`;
  await sql`INSERT INTO orders (organization_id, client_id, order_number, client_name_snapshot, object_name_snapshot, object_address_snapshot, status, currency)
    SELECT ${org.id}, ${client.id}, 'LONG-' || n, 'Снимок заказчика ' || n, 'Объект поиска ' || n, 'Тестовый адрес', 'new', 'RUB'
    FROM generate_series(1, 67) n`;
  const pages = []; let offset = 0;
  do {
    const page = await searchNoteDestinations(member(author.id), '', offset);
    pages.push(...page.items);
    assert.equal(page.items.length <= 31, true);
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(pages.length, 136);
  assert.equal(new Set(pages.map((item) => `${item.kind}:${item.id}`)).size, 136);
  assert.equal(pages.filter((item) => item.kind === 'dashboard').length, 1);
  const oldClient = await searchNoteDestinations(member(author.id), 'Большая база 67');
  assert.equal(oldClient.items[1].label, 'Клиент · Большая база 67');
  const snapshotOrder = await searchNoteDestinations(member(author.id), 'Объект поиска 67');
  assert(snapshotOrder.items.some((item) => item.label === 'Заказ LONG-67 · Снимок заказчика 67'));
  const blocked = await searchNoteDestinations({ ...member(author.id), permissionOverrides: { 'orders.read': false, 'clients.read': false } }, '');
  assert.equal(blocked.total, 1);
  assert.deepEqual(blocked.items.map((item) => item.kind), ['dashboard']);

  // Searching must not disclose foreign names from expired/inactive center grants.
  const [center] = await sql`INSERT INTO organizations (name, organization_kind, timezone) VALUES ('Центр заметок', 'center', 'Europe/Moscow') RETURNING id`;
  const [principal] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${center.id}, 'Center owner', 'center@notes.invalid', 'admin') RETURNING id`;
  const [session] = await sql`INSERT INTO auth_sessions (organization_id, member_id, token_hash, expires_at)
    VALUES (${center.id}, ${principal.id}, ${'a'.repeat(64)}, now() + interval '1 day') RETURNING id`;
  await sql`INSERT INTO organization_access_grants (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
    VALUES (${center.id}, ${principal.id}, ${org.id}, ${author.id})`;
  const centerMember = { ...member(principal.id), organizationId: center.id, role: 'owner', sessionId: session.id };
  let centerResults = await searchNoteDestinations(centerMember, 'LONG-67');
  assert.equal(centerResults.items[1].detail, 'Notes Test');
  assert.equal(await canAccessNoteTarget(centerMember, centerResults.items[1]), true);
  await sql`UPDATE organization_members SET active = false WHERE id = ${author.id}`;
  assert.equal((await searchNoteDestinations(centerMember, 'LONG-67')).total, 1);
  await sql`UPDATE organization_members SET active = true WHERE id = ${author.id}`;
  await sql`UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = ${session.id}`;
  assert.equal((await searchNoteDestinations(centerMember, 'LONG-67')).total, 1);

  const clientTarget = { kind: 'client', organizationId: org.id, id: client.id };
  const foreignTarget = { kind: 'client', organizationId: otherOrg.id, id: otherClient.id };
  const saved = await savePersonalNoteAction({ target: clientTarget, title: 'Договор', body: 'Уточнить график',
    template: { name: 'Мой шаблон', body: 'Текст шаблона' } });
  assert.equal(saved.notes.length, 1);
  assert.equal(saved.templates.length, 1);
  assert.equal(saved.templates[0].kind, 'plain');
  const noteId = saved.notes[0].id;
  const templateId = saved.templates[0].id;
  currentMember = member(colleague.id);
  assert.deepEqual(await listPersonalNotes(currentMember, clientTarget), []);
  assert.deepEqual(await listPersonalNoteTemplates(currentMember), []);
  await assert.rejects(() => savePersonalNoteAction({ target: clientTarget, id: noteId, title: 'Чужая', body: 'Правка' }), /Заметка не найдена/);
  await assert.rejects(() => transferPersonalNoteAction({ source: clientTarget, destination: dashboard, id: noteId, mode: 'copy' }), /Заметка не найдена/);
  await deletePersonalNoteAction({ target: clientTarget, id: noteId });
  await deletePersonalNoteTemplateAction(templateId);
  currentMember = member(author.id);
  assert.equal((await listPersonalNotes(currentMember, clientTarget))[0].body, 'Уточнить график');
  assert.equal((await listPersonalNoteTemplates(currentMember)).length, 1);
  await assert.rejects(() => transferPersonalNoteAction({ source: clientTarget, destination: foreignTarget, id: noteId, mode: 'move' }), /Место назначения недоступно/);
  await transferPersonalNoteAction({ source: clientTarget, destination: dashboard, id: noteId, mode: 'copy' });
  assert.equal((await listPersonalNotes(currentMember, clientTarget)).length, 1);
  assert.equal((await listPersonalNotes(currentMember, dashboard)).length, 2);
  await transferPersonalNoteAction({ source: clientTarget, destination: dashboard, id: noteId, mode: 'move' });
  assert.deepEqual(await listPersonalNotes(currentMember, clientTarget), []);
  assert.equal((await listPersonalNotes(currentMember, dashboard)).length, 3);
  const [moved] = await sql`SELECT target_kind, target_id FROM personal_notes WHERE id = ${noteId}`;
  assert.equal(moved.target_kind, 'dashboard');
  assert.equal(moved.target_id, null);
  const structured = await savePersonalNoteAction({ target: dashboard, title: 'Новый тариф', body: 'Услуга: Дератизация',
    template: { name: 'Тариф по м²', body: 'Название объекта: {{object}}\nПлощадь объекта: 50\nНаименование услуг: Дератизация\nЦена за кВ.м.: 0,23\nОбщий чек: 11,50\nОбслуживание: ежемесячно', kind: 'liza_order' } });
  assert.equal(structured.templates.find((item) => item.name === 'Тариф по м²')?.kind, 'liza_order');
  const concurrent = await savePersonalNoteAction({ target: clientTarget, title: 'Одно место', body: 'Не потерять при двух переносах' });
  const outcomes = await Promise.allSettled([0, 1].map(() => transferPersonalNoteAction({ source: clientTarget,
    destination: dashboard, id: concurrent.notes[0].id, mode: 'move' })));
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
  await assert.rejects(() => transferPersonalNoteAction({ source: dashboard, destination: clientTarget,
    id: concurrent.notes[0].id, mode: 'unknown' }), /Invalid option/);

});
