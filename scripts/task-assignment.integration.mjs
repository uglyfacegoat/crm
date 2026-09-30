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
const { createTask, getTaskDashboardSummary, listTasks, listTaskPage, listMyTaskPage, searchTaskOptions, updateTask, completeTask } = await import("../src/server/tasks/repository.ts");
const { createTaskSchema, taskPickerQuerySchema, myTaskPageQuerySchema } = await import("../src/server/tasks/schemas.ts");

test("tasks assigned by the owner appear under each employee's own member ID", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_task_assignment_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll(); hooks.deregister(); await sql.end();
    try { await admin`DROP DATABASE ${admin(databaseName)}`; } finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Tasks team', 'Europe/Moscow') RETURNING id`;
  async function employee(name, role) {
    const email = `${name.toLowerCase()}@example.test`;
    const [row] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, ${name}, ${email}, ${role === 'owner' ? 'admin' : role}) RETURNING id`;
    return { sessionId: null, organizationId: organization.id, organizationName: 'Tasks team',
      memberId: row.id, displayName: name, email, role, masterId: null, permissionOverrides: {} };
  }
  const max = await employee('Max', 'owner');
  const staff = [max, await employee('Liza', 'crm_coordinator'), await employee('Nikita', 'sales_lead'),
    await employee('Tatiana', 'deputy'), await employee('Victoria', 'finance_controller')];

  const createdTasks = new Map();
  for (const person of staff) {
    const id = await createTask(max, createTaskSchema.parse({
      idempotencyKey: randomUUID(), relatedOrderId: '', title: `Изучить CRM: ${person.displayName}`,
      description: '', priority: 'normal', assignedMemberId: person.memberId, localDate: '', localTime: '',
    }));
    const [stored] = await sql`SELECT assigned_member_id FROM tasks WHERE organization_id = ${organization.id} AND id = ${id}`;
    assert.equal(stored.assigned_member_id, person.memberId);
    createdTasks.set(person.displayName, id);
    const notices = await sql`SELECT recipient_member_id, kind, body FROM notifications
      WHERE organization_id = ${organization.id} AND source_id = ${id} AND resolved_at IS NULL`;
    assert.deepEqual(notices.map((notice) => [notice.recipient_member_id, notice.kind, notice.body]),
      [[person.memberId, 'task_assigned', `Изучить CRM: ${person.displayName}`]]);
  }
  for (const person of staff) {
    const snapshot = await listTasks(person);
    assert.equal(snapshot.currentMemberId, person.memberId);
    assert.equal(snapshot.tasks.length, staff.length);
    assert.deepEqual(snapshot.tasks.filter((task) => task.assignedMemberId === snapshot.currentMemberId)
      .map((task) => task.title), [`Изучить CRM: ${person.displayName}`]);
    assert.deepEqual(snapshot.myTasks.map((task) => task.title), [`Изучить CRM: ${person.displayName}`]);
  }

  const lizaTaskId = createdTasks.get('Liza');
  const liza = staff[1];
  const reassignedVersion = await updateTask(max, {
    taskId: lizaTaskId, expectedVersion: 1, title: 'Изучить CRM: Liza', description: '',
    priority: 'normal', assignedMemberId: staff[2].memberId, localDate: '', localTime: '',
  });
  assert.equal(reassignedVersion, 2);
  const reassignmentNotices = await sql`SELECT recipient_member_id, resolved_at, event_key FROM notifications
    WHERE organization_id = ${organization.id} AND source_id = ${lizaTaskId} ORDER BY event_key`;
  assert.equal(reassignmentNotices.length, 2);
  assert.equal(reassignmentNotices[0].recipient_member_id, liza.memberId);
  assert.ok(reassignmentNotices[0].resolved_at);
  assert.equal(reassignmentNotices[1].recipient_member_id, staff[2].memberId);
  assert.equal(reassignmentNotices[1].resolved_at, null);
  await completeTask(max, { taskId: lizaTaskId, expectedVersion: 2 });
  const [openNotices] = await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE organization_id = ${organization.id} AND source_id = ${lizaTaskId} AND resolved_at IS NULL`;
  assert.equal(openNotices.count, 0);

  const retryKey = randomUUID();
  const retryInput = createTaskSchema.parse({ idempotencyKey: retryKey, relatedOrderId: '',
    title: 'Повторная отправка задачи', description: '', priority: 'normal',
    assignedMemberId: liza.memberId, localDate: '', localTime: '' });
  const firstRetryId = await createTask(max, retryInput);
  assert.equal(await createTask(max, retryInput), firstRetryId);
  const [retryNoticeCount] = await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE organization_id = ${organization.id} AND source_id = ${firstRetryId} AND kind = 'task_assigned'`;
  assert.equal(retryNoticeCount.count, 1);

  await sql`INSERT INTO tasks (organization_id, title, due_at, assigned_member_id)
    SELECT ${organization.id}, 'Другая просроченная задача ' || n, now() - interval '1 day', ${max.memberId}
    FROM generate_series(1, 510) AS n`;
  const crowdedSnapshot = await listTasks(liza);
  assert.equal(crowdedSnapshot.tasks.length, 500);
  assert.equal(crowdedSnapshot.tasks.some((task) => task.id === firstRetryId), false);
  assert.deepEqual(crowdedSnapshot.myTasks.map((task) => task.id), [firstRetryId]);
  await sql`INSERT INTO tasks (organization_id, title, priority, due_at, assigned_member_id, created_at)
    SELECT ${organization.id}, CASE WHEN n = 520 THEN 'Янтарная личная задача за пределом 500' ELSE 'Личная задача ' || n END,
      CASE WHEN n = 520 THEN 'high' ELSE 'normal' END,
      CASE WHEN n = 520 THEN now() + interval '2 days' ELSE NULL END,
      ${liza.memberId}, now() - n * interval '1 minute'
      FROM generate_series(1, 520) AS n`;
  const manyMine = await listTasks(liza);
  assert.equal(manyMine.myTasks.length, 50);
  assert.equal(manyMine.myTasksTotal, 521);
  const allSnapshot = await listTasks(liza, null, 50);
  assert.equal(allSnapshot.tasks.length, 50);
  assert.equal(allSnapshot.tasksTotal, 1035);
  const deepAll = await listTaskPage(liza, myTaskPageQuerySchema.parse({ page: 20 }), 'all');
  assert.equal(deepAll.total, 1035);
  assert.ok(deepAll.tasks.some((task) => task.title === 'Янтарная личная задача за пределом 500'));
  const searchedAll = await listTaskPage(max, myTaskPageQuerySchema.parse({ q: 'Янтарная личная', priority: 'high', assignee: liza.memberId }), 'all');
  assert.deepEqual(searchedAll.tasks.map((task) => task.title), ['Янтарная личная задача за пределом 500']);
  assert.equal(searchedAll.total, 1);
  const deepMine = await listMyTaskPage(liza, myTaskPageQuerySchema.parse({ page: 10 }));
  assert.equal(deepMine.total, 521);
  assert.ok(deepMine.tasks.some((task) => task.title === 'Янтарная личная задача за пределом 500'));
  const searchedMine = await listMyTaskPage(liza, myTaskPageQuerySchema.parse({ q: 'Янтарная личная', priority: 'high' }));
  assert.deepEqual(searchedMine.tasks.map((task) => task.title), ['Янтарная личная задача за пределом 500']);
  const filteredMine = await listMyTaskPage(liza, myTaskPageQuerySchema.parse({
    dateFrom: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    dateTo: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
  }));
  assert.equal(filteredMine.total, 1);
  assert.equal((await listMyTaskPage(max, myTaskPageQuerySchema.parse({ q: 'Янтарная личная' }))).total, 0);

  const departed = await employee('Departed', 'crm_coordinator');
  const departedTaskId = await createTask(max, createTaskSchema.parse({
    idempotencyKey: randomUUID(), relatedOrderId: '', title: 'Передать задачу после ухода сотрудника',
    description: '', priority: 'normal', assignedMemberId: departed.memberId, localDate: '', localTime: '',
  }));
  const unassignedTaskId = await createTask(max, createTaskSchema.parse({
    idempotencyKey: randomUUID(), relatedOrderId: '', title: 'Назначить ответственного',
    description: '', priority: 'normal', assignedMemberId: '', localDate: '', localTime: '',
  }));
  await sql`UPDATE organization_members SET active = false WHERE organization_id = ${organization.id} AND id = ${departed.memberId}`;
  const recovery = await listTasks(max);
  assert.equal(recovery.tasks.some((task) => task.id === departedTaskId), false, 'The general 500-item limit may hide a stranded task');
  assert.equal(recovery.strandedTotal, 2);
  assert.deepEqual(new Set(recovery.strandedTasks.map((task) => task.id)), new Set([departedTaskId, unassignedTaskId]));
  assert.ok(recovery.strandedTasks.every((task) => task.needsAssignment));
  assert.equal((await listTasks(liza)).myTasks.some((task) => task.id === departedTaskId), false);
  await updateTask(max, { taskId: departedTaskId, expectedVersion: 1, title: 'Передать задачу после ухода сотрудника', description: '',
    priority: 'normal', assignedMemberId: liza.memberId, localDate: '', localTime: '' });
  const afterRecovery = await listTasks(max);
  assert.deepEqual(afterRecovery.strandedTasks.map((task) => task.id), [unassignedTaskId]);
  assert.ok((await listTasks(liza)).myTasks.some((task) => task.id === departedTaskId));
  await sql`INSERT INTO tasks (organization_id, title, assigned_member_id, created_at)
    SELECT ${organization.id}, CASE WHEN n = 520 THEN 'Янтарная задача без исполнителя' ELSE 'Без исполнителя ' || n END,
      NULL, now() - n * interval '1 minute' FROM generate_series(1, 520) AS n`;
  const strandedSnapshot = await listTasks(max, null, 50, 50);
  assert.equal(strandedSnapshot.strandedTasks.length, 50);
  assert.equal(strandedSnapshot.strandedTotal, 521);
  const deepStranded = await listTaskPage(max, myTaskPageQuerySchema.parse({ page: 10 }), 'stranded');
  assert.equal(deepStranded.total, 521);
  assert.ok(deepStranded.tasks.some((task) => task.title === 'Янтарная задача без исполнителя'));
  const searchedStranded = await listTaskPage(max, myTaskPageQuerySchema.parse({ q: 'Янтарная задача без исполнителя' }), 'stranded');
  assert.deepEqual(searchedStranded.tasks.map((task) => task.title), ['Янтарная задача без исполнителя']);
  assert.ok(searchedStranded.tasks[0].needsAssignment);
  await sql`INSERT INTO tasks (organization_id, title, due_at)
    VALUES (${organization.id}, 'Старая просроченная задача', now() - interval '30 days')`;
  const moscowDateParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const dashboardDate = `${moscowDateParts.year}-${moscowDateParts.month}-${moscowDateParts.day}`;
  const dashboardSummary = await getTaskDashboardSummary(liza, 'Europe/Moscow', dashboardDate);
  assert.equal(dashboardSummary.overdueCount, 511, 'the dashboard must count overdue tasks beyond the first 500');
  assert.equal(dashboardSummary.dailyCounts.reduce((sum, count) => sum + count, 0), 510,
    'the seven-day chart must exclude old overdue tasks');

  await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    SELECT ${organization.id}, CASE WHEN n = 510 THEN 'Янтарный сотрудник' ELSE 'Сотрудник ' || n END,
      'member-' || n || '@example.test', 'manager' FROM generate_series(1, 510) AS n`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, kind)
    VALUES (${organization.id}, 'Клиент для выбора задач', 'individual') RETURNING id`;
  await sql`INSERT INTO orders (organization_id, client_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot)
    SELECT ${organization.id}, ${client.id}, CASE WHEN n = 210 THEN 'ЯНТАРНЫЙ-ЗАКАЗ' ELSE 'ТЕСТ-' || n END,
      'new', 'RUB', 'Клиент для выбора задач', 'Объект не указан', 'Адрес не указан'
    FROM generate_series(1, 210) AS n`;
  const assigneeSearch = await searchTaskOptions(max, taskPickerQuerySchema.parse({ type: 'assignees', q: 'Янтарный' }));
  assert.deepEqual(assigneeSearch.items.map((item) => item.name), ['Янтарный сотрудник']);
  const orderSearch = await searchTaskOptions(max, taskPickerQuerySchema.parse({ type: 'orders', q: 'ЯНТАРНЫЙ' }));
  assert.deepEqual(orderSearch.items.map((item) => item.name), ['ЯНТАРНЫЙ-ЗАКАЗ']);
  assert.equal((await searchTaskOptions(max, taskPickerQuerySchema.parse({ type: 'assignees' }))).hasMore, true);
  assert.equal((await searchTaskOptions(max, taskPickerQuerySchema.parse({ type: 'orders' }))).hasMore, true);
  const [other] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Other tasks team', 'Europe/Moscow') RETURNING id`;
  await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${other.id}, 'Секретный сотрудник', 'secret@example.test', 'manager')`;
  assert.equal((await searchTaskOptions(max, taskPickerQuerySchema.parse({ type: 'assignees', q: 'Секретный' }))).items.length, 0);
});
