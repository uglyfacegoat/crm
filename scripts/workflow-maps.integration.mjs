import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must identify an isolated test PostgreSQL instance.");
const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, sourceRoot).href, context);
      if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let sql;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => sql } });
const workflow = await import("../src/server/workflow/repository.ts");
const versions = await import("../src/server/workflow/versions-repository.ts");
const context = await import("../src/server/workflow/context-repository.ts");
const contextAccess = await import("../src/server/workflow/context-access.ts");
const collaboration = await import("../src/server/workflow/collaboration-repository.ts");
const automation = await import("../src/server/workflow/automation-repository.ts");
const publisher = await import("../src/server/domain-events/order-created.ts");
const worker = await import("../src/server/workflow/worker-engine.ts");
const orders = await import("../src/server/orders/repository.ts");
const orderCopy = await import("../src/server/orders/copy-repository.ts");
const orderSchemas = await import("../src/server/orders/schemas.ts");
const quickOrders = await import("../src/server/quick-order/repository.ts");
const quickOrderSchemas = await import("../src/server/quick-order/schemas.ts");
const taskRepository = await import("../src/server/tasks/repository.ts");
const notifications = await import("../src/server/notifications/repository.ts");
const { saveWorkflowMapSchema } = await import("../src/server/workflow/schemas.ts");

test("workflow maps are tenant scoped, permission gated and version safe", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_workflow_test_${randomUUID().replaceAll("-", "")}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4 });
  t.after(async () => {
    mock.restoreAll();
    hooks.deregister();
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); }
  });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });

  async function member(role, organizationId = null) {
    const organization = organizationId ? { id: organizationId } : (await sql`INSERT INTO organizations (name, timezone)
      VALUES ('Workflow integration', 'Europe/Moscow') RETURNING id`)[0];
    const id = randomUUID();
    await sql`INSERT INTO organization_members (id, organization_id, display_name, email, role)
      VALUES (${id}, ${organization.id}, ${role}, ${`${id}@example.invalid`}, ${role})`;
    return { organizationId: organization.id, memberId: id, role, displayName: role,
      permissionOverrides: {}, sessionId: null };
  }

  const owner = await member("admin");
  const reader = await member("dispatcher", owner.organizationId);
  const other = await member("admin");
  const id = randomUUID();
  assert.equal(await workflow.createWorkflowMap(owner, { id, title: "Путь заявки" }), id);
  assert.equal(await workflow.createWorkflowMap(owner, { id, title: "Путь заявки" }), id);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_maps WHERE id = ${id}`)[0].count, 1);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM audit_events WHERE entity_id = ${id} AND action = 'workflow.map.create'`)[0].count, 1);
  await assert.rejects(workflow.createWorkflowMap(reader, { id: randomUUID(), title: "Нельзя" }), AuthorizationError);
  await assert.rejects(workflow.createWorkflowMap(other, { id, title: "Чужой ключ" }), workflow.WorkflowMapConflictError);
  const deniedOwner = { ...owner, permissionOverrides: { "workflow.write": false } };
  await assert.rejects(workflow.createWorkflowMap(deniedOwner, { id: randomUUID(), title: "Запрещено настройкой" }), AuthorizationError);
  const unreadableOwner = { ...owner, permissionOverrides: { "workflow.read": false } };
  await assert.rejects(workflow.saveWorkflowMap(unreadableOwner, { id, expectedVersion: 1, title: "Не читать", description: "", draft: { nodes: [], edges: [] } }), AuthorizationError);
  assert.equal((await workflow.getWorkflowWorkspace(reader, id)).selected?.title, "Путь заявки");
  assert.equal((await workflow.getWorkflowWorkspace(other, id)).selected, null);
  assert.deepEqual((await workflow.getWorkflowWorkspace(other, null)).maps, []);

  const firstNode = { id: randomUUID(), kind: "event", title: "Новая заявка", description: "", x: 80, y: 100 };
  const secondNode = { id: randomUUID(), kind: "crm_card", title: "Карточка заказа", description: "", x: 320, y: 100 };
  const draft = { nodes: [firstNode, secondNode], edges: [{ id: randomUUID(), sourceId: firstNode.id, targetId: secondNode.id, label: "создать" }] };
  assert.equal(saveWorkflowMapSchema.safeParse({ id, expectedVersion: 1, title: "Путь заявки", description: "", draft }).success, true);
  assert.equal(saveWorkflowMapSchema.safeParse({ id, expectedVersion: 1, title: "Путь заявки", description: "", draft: { nodes: [firstNode], edges: draft.edges } }).success, false);
  assert.equal(await workflow.saveWorkflowMap(owner, { id, expectedVersion: 1, title: "Путь заявки до заказа", description: "Рабочий черновик", draft }), 2);
  await assert.rejects(workflow.saveWorkflowMap(owner, { id, expectedVersion: 1, title: "Устарело", description: "", draft }), workflow.WorkflowMapConflictError);
  await assert.rejects(workflow.saveWorkflowMap(other, { id, expectedVersion: 2, title: "Чужая карта", description: "", draft }), workflow.WorkflowMapNotFoundError);
  await assert.rejects(workflow.saveWorkflowMap(reader, { id, expectedVersion: 2, title: "Без прав", description: "", draft }), AuthorizationError);
  const saved = (await workflow.getWorkflowWorkspace(owner, id)).selected;
  assert.equal(saved?.version, 2);
  assert.equal(saved?.title, "Путь заявки до заказа");
  assert.deepEqual(saved?.draft, draft);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM audit_events WHERE entity_id = ${id} AND action = 'workflow.map.save'`)[0].count, 1);

  await assert.rejects(workflow.archiveWorkflowMap(owner, { id, expectedVersion: 1 }), workflow.WorkflowMapConflictError);
  await workflow.archiveWorkflowMap(owner, { id, expectedVersion: 2 });
  assert.equal((await workflow.getWorkflowWorkspace(owner, id)).selected, null);
  await assert.rejects(workflow.saveWorkflowMap(owner, { id, expectedVersion: 3, title: "Вернуть", description: "", draft }), workflow.WorkflowMapNotFoundError);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_maps WHERE id = ${id} AND archived_at IS NOT NULL`)[0].count, 1);

  const reviewer = await member("manager", owner.organizationId);
  const versionMapId = randomUUID();
  await workflow.createWorkflowMap(owner, { id: versionMapId, title: "Согласование процесса" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_map_revisions WHERE map_id = ${versionMapId}`)[0].count, 1);
  await workflow.saveWorkflowMap(owner, { id: versionMapId, expectedVersion: 1, title: "Процесс до публикации", description: "Описание", draft });
  await versions.requestWorkflowReview(owner, { id: versionMapId, expectedVersion: 2 });
  await assert.rejects(versions.approveWorkflowReview(owner, { id: versionMapId, expectedVersion: 2 }),
    (error) => error instanceof versions.WorkflowReviewStateError && error.reason === "self_review");
  await assert.rejects(versions.publishWorkflowRevision(reviewer, { id: versionMapId, expectedVersion: 2 }), AuthorizationError);
  await assert.rejects(versions.publishWorkflowRevision(owner, { id: versionMapId, expectedVersion: 2 }),
    (error) => error instanceof versions.WorkflowReviewStateError && error.reason === "not_approved");
  await versions.approveWorkflowReview(reviewer, { id: versionMapId, expectedVersion: 2 });
  await assert.rejects(versions.requestWorkflowReview(owner, { id: versionMapId, expectedVersion: 2 }),
    (error) => error instanceof versions.WorkflowReviewStateError && error.reason === "already_approved");
  await versions.publishWorkflowRevision(owner, { id: versionMapId, expectedVersion: 2 });
  await versions.publishWorkflowRevision(owner, { id: versionMapId, expectedVersion: 2 });
  assert.equal((await sql`SELECT published_version FROM workflow_maps WHERE id = ${versionMapId}`)[0].published_version, 2);
  assert.equal((await workflow.getWorkflowWorkspace(reader, versionMapId)).selected?.publishedVersion, 2);
  const published = await versions.getWorkflowRevision(reader, { id: versionMapId, version: 2 });
  assert.equal(published.title, "Процесс до публикации");
  assert.deepEqual(published.draft, draft);
  await assert.rejects(versions.getWorkflowRevision(other, { id: versionMapId, version: 2 }), workflow.WorkflowMapNotFoundError);
  await assert.rejects(sql`UPDATE workflow_map_revisions SET title = 'Mutated' WHERE map_id = ${versionMapId} AND version = 2`);

  await workflow.saveWorkflowMap(owner, { id: versionMapId, expectedVersion: 2, title: "Новый черновик", description: "После публикации", draft });
  const afterSave = (await workflow.getWorkflowWorkspace(owner, versionMapId)).selected;
  assert.equal(afterSave?.publishedVersion, 2);
  assert.equal(afterSave?.reviewVersion, null);
  assert.equal(afterSave?.approvedVersion, null);
  assert.equal((await versions.getWorkflowRevision(owner, { id: versionMapId, version: 2 })).title, "Процесс до публикации");
  await versions.requestWorkflowReview(owner, { id: versionMapId, expectedVersion: 3 });
  await versions.rejectWorkflowReview(reviewer, { id: versionMapId, expectedVersion: 3, reason: "Уточнить развилку" });
  assert.equal((await workflow.getWorkflowWorkspace(owner, versionMapId)).selected?.reviewVersion, null);
  await versions.requestWorkflowReview(owner, { id: versionMapId, expectedVersion: 3 });
  await versions.approveWorkflowReview(reviewer, { id: versionMapId, expectedVersion: 3 });
  const restoredVersion = await versions.restoreWorkflowRevision(owner, { id: versionMapId, expectedVersion: 3, sourceVersion: 1 });
  assert.equal(restoredVersion, 4);
  const restored = (await workflow.getWorkflowWorkspace(owner, versionMapId)).selected;
  assert.equal(restored?.version, 4);
  assert.equal(restored?.title, "Согласование процесса");
  assert.deepEqual(restored?.draft, { nodes: [], edges: [] });
  assert.equal(restored?.reviewVersion, null);
  assert.equal(restored?.publishedVersion, 2);
  assert.equal((await versions.getWorkflowRevision(owner, { id: versionMapId, version: 4 })).sourceVersion, 1);
  await assert.rejects(versions.publishWorkflowRevision(owner, { id: versionMapId, expectedVersion: 4 }),
    (error) => error instanceof versions.WorkflowReviewStateError && error.reason === "not_approved");
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_map_revisions WHERE map_id = ${versionMapId}`)[0].count, 4);

  const [client] = await sql`INSERT INTO clients (organization_id, legal_name)
    VALUES (${owner.organizationId}, 'Клиент для процесса') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${owner.organizationId}, ${client.id}, 'Объект для процесса', 'Офис', 'Москва, Тестовая улица, 1') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-001', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва, Тестовая улица, 1') RETURNING id`;
  const automationMapId = randomUUID();
  await workflow.createWorkflowMap(owner, { id: automationMapId, title: 'Проверка заказа' });
  const automationDraft = { nodes: [
    { ...firstNode, automation: { kind: 'order_created' } },
    { ...secondNode, kind: 'action', automation: { kind: 'create_order_task', title: 'Проверить заказ',
      priority: 'high', assignedMemberId: reviewer.memberId } },
  ], edges: draft.edges };
  await workflow.saveWorkflowMap(owner, { id: automationMapId, expectedVersion: 1,
    title: 'Проверка заказа', description: '', draft: automationDraft });
  await versions.requestWorkflowReview(owner, { id: automationMapId, expectedVersion: 2 });
  await versions.approveWorkflowReview(reviewer, { id: automationMapId, expectedVersion: 2 });
  await versions.publishWorkflowRevision(owner, { id: automationMapId, expectedVersion: 2 });
  const previewPlan = await automation.previewOrderCreatedAutomation(owner, automationMapId, order.id);
  assert.equal(previewPlan.mapVersion, 2);
  assert.equal(previewPlan.orderNumber, 'WF-TEST-001');
  assert.deepEqual(previewPlan.tasks, [{ nodeId: secondNode.id, title: 'Проверить заказ',
    priority: 'high', assignedMemberId: reviewer.memberId }]);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${order.id}`)[0].count, 0);
  await assert.rejects(automation.previewOrderCreatedAutomation(other, automationMapId, order.id), workflow.WorkflowMapNotFoundError);
  await assert.rejects(automation.previewOrderCreatedAutomation(owner, automationMapId, randomUUID()),
    (error) => error instanceof automation.WorkflowAutomationTargetError && error.reason === 'order_unavailable');
  await assert.rejects(automation.previewOrderCreatedAutomation({ ...owner, permissionOverrides: { 'tasks.write': false } }, automationMapId, order.id), AuthorizationError);
  await sql`UPDATE organization_members SET active = false WHERE organization_id = ${owner.organizationId} AND id = ${reviewer.memberId}`;
  await assert.rejects(automation.previewOrderCreatedAutomation(owner, automationMapId, order.id),
    (error) => error instanceof automation.WorkflowAutomationTargetError && error.reason === 'assignee_unavailable');
  await sql`UPDATE organization_members SET active = true WHERE organization_id = ${owner.organizationId} AND id = ${reviewer.memberId}`;
  const secondAdmin = await member('admin', owner.organizationId);
  await assert.rejects(automation.enableOrderCreatedAutomation(secondAdmin, automationMapId, 2),
    (error) => error instanceof automation.WorkflowAutomationTargetError && error.reason === 'trial_required');
  assert.equal(await automation.enableOrderCreatedAutomation(owner, automationMapId, 2), 2);
  assert.equal(await automation.enableOrderCreatedAutomation(owner, automationMapId, 2), 2);
  assert.equal((await automation.getWorkflowAutomationState(owner, automationMapId)).activeVersion, 2);
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, order.id));
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, order.id));
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_automation_jobs
    WHERE organization_id = ${owner.organizationId} AND map_id = ${automationMapId}`)[0].count, 1);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 1, failed: 0, stopped: 0 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks
    WHERE organization_id = ${owner.organizationId} AND related_order_id = ${order.id} AND source = 'workflow'`)[0].count, 1);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM task_events event JOIN tasks task
    ON task.organization_id = event.organization_id AND task.id = event.task_id
    WHERE task.related_order_id = ${order.id} AND task.source = 'workflow' AND event.event_type = 'created'`)[0].count, 1);
  const [workflowTask] = await sql`SELECT id FROM tasks WHERE related_order_id = ${order.id} AND source = 'workflow'`;
  assert.equal(await taskRepository.completeTask(owner, { taskId: workflowTask.id, expectedVersion: 1 }), 2);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM task_events WHERE task_id = ${workflowTask.id}`)[0].count, 2);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 0, stopped: 0 });
  const [secondOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-002', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, secondOrder.id));
  assert.equal(await automation.stopOrderCreatedAutomation(owner, automationMapId), true);
  assert.equal((await sql`SELECT status FROM workflow_automation_jobs WHERE map_id = ${automationMapId}
    AND order_id = ${secondOrder.id}`)[0].status, 'stopped');
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 0, stopped: 0 });
  const [stoppedOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-STOPPED', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, stoppedOrder.id));
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_automation_jobs WHERE map_id = ${automationMapId}`)[0].count, 2);
  await automation.enableOrderCreatedAutomation(owner, automationMapId, 2);
  const [workerOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-WORKER', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, workerOrder.id));
  const workerCli = spawnSync(process.execPath, ['--experimental-transform-types', 'scripts/workflow-worker.mjs', '--once'],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(workerCli.status, 0, workerCli.stderr);
  assert.equal((await sql`SELECT status FROM workflow_automation_jobs WHERE map_id = ${automationMapId}
    AND order_id = ${workerOrder.id}`)[0].status, 'succeeded');
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${workerOrder.id}`)[0].count, 1);
  const [contact] = await sql`INSERT INTO client_contacts (organization_id, client_id, full_name, phone, normalized_phone)
    VALUES (${owner.organizationId}, ${client.id}, 'Контакт заказа', '+79990000000', '+79990000000') RETURNING id`;
  const orderInput = orderSchemas.createOrderSchema.parse({ idempotencyKey: randomUUID(),
    clientId: client.id, objectId: object.id, contactId: contact.id,
    assignedMasterId: '', masterPayment: '', notes: '',
    services: [{ name: 'Обработка', quantity: '1', unitPrice: '100', note: '' }], expenses: [] });
  const domainOrderId = await orders.createOrder(owner, orderInput);
  assert.equal(await orders.createOrder(owner, orderInput), domainOrderId);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_automation_jobs
    WHERE map_id = ${automationMapId} AND order_id = ${domainOrderId}`)[0].count, 1);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 1, failed: 0, stopped: 0 });
  const [service] = await sql`SELECT id FROM order_services WHERE order_id = ${domainOrderId}`;
  const copyInput = orderSchemas.copyOrderSchema.parse({ idempotencyKey: randomUUID(),
    sourceOrderId: domainOrderId, expectedVersion: 1, copyDate: '2026-10-05',
    serviceIds: [service.id], expenseIds: [], visitIds: [], copyMaster: false, copyNotes: false });
  const copiedOrderId = await orderCopy.copyOrder(owner, copyInput);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_automation_jobs
    WHERE map_id = ${automationMapId} AND order_id = ${copiedOrderId}`)[0].count, 1);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 1, failed: 0, stopped: 0 });
  const quickInput = quickOrderSchemas.quickOrderSchema.parse({ idempotencyKey: randomUUID(), sourceLead: null,
    client: { mode: 'existing', clientId: client.id,
      contact: { mode: 'existing', contactId: contact.id }, object: { mode: 'existing', objectId: object.id } },
    order: { assignedMasterId: '', masterPayment: '', notes: '',
      services: [{ name: 'Обработка', quantity: '1', unitPrice: '100', note: '' }], expenses: [] },
    visit: { localDate: '2026-10-06', localTime: '10:00', durationMinutes: 60,
      assignedMasterId: '', notes: '' } });
  const quickResult = await quickOrders.createQuickOrder(owner, quickInput);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_automation_jobs
    WHERE map_id = ${automationMapId} AND order_id = ${quickResult.orderId}`)[0].count, 1);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 1, failed: 0, stopped: 0 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks
    WHERE related_order_id = ${quickResult.orderId} AND source = 'workflow'`)[0].count, 1);
  const [thirdOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-003', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, thirdOrder.id));
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${owner.organizationId}, ${owner.memberId}, 'tasks.write', false)`;
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 1, stopped: 0 });
  assert.equal((await sql`SELECT status, last_error_code FROM workflow_automation_jobs
    WHERE map_id = ${automationMapId} AND order_id = ${thirdOrder.id}`)[0].last_error_code, 'ACTOR_PERMISSION_REVOKED');
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${thirdOrder.id}`)[0].count, 0);
  await sql`DELETE FROM member_permission_overrides WHERE organization_id = ${owner.organizationId}
    AND member_id = ${owner.memberId} AND permission = 'tasks.write'`;
  const [retryOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-RETRY', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, retryOrder.id));
  await sql`ALTER TABLE task_events RENAME TO task_events_temporarily_unavailable`;
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 1, stopped: 0 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${retryOrder.id}`)[0].count, 0);
  await sql`ALTER TABLE task_events_temporarily_unavailable RENAME TO task_events`;
  await sql`UPDATE workflow_automation_jobs SET next_attempt_at = now()
    WHERE map_id = ${automationMapId} AND order_id = ${retryOrder.id}`;
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 1, failed: 0, stopped: 0 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${retryOrder.id}`)[0].count, 1);
  const [failedOrder] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${owner.organizationId}, ${client.id}, ${object.id}, 'WF-TEST-FAILED', 'new', 'RUB',
      'Клиент для процесса', 'Объект для процесса', 'Москва') RETURNING id`;
  await sql.begin((transaction) => publisher.publishOrderCreated(transaction, owner.organizationId, failedOrder.id));
  await sql`ALTER TABLE task_events RENAME TO task_events_temporarily_unavailable`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 1, stopped: 0 });
    await sql`UPDATE workflow_automation_jobs SET next_attempt_at = now()
      WHERE map_id = ${automationMapId} AND order_id = ${failedOrder.id} AND status = 'pending'`;
  }
  await sql`ALTER TABLE task_events_temporarily_unavailable RENAME TO task_events`;
  assert.deepEqual((await sql`SELECT status, attempts FROM workflow_automation_jobs
    WHERE map_id = ${automationMapId} AND order_id = ${failedOrder.id}`)[0], { status: 'failed', attempts: 3 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM tasks WHERE related_order_id = ${failedOrder.id}`)[0].count, 0);
  assert.deepEqual(await worker.processWorkflowJobs(sql), { succeeded: 0, failed: 0, stopped: 0 });
  await workflow.archiveWorkflowMap(owner, { id: automationMapId, expectedVersion: 2 });
  assert.equal((await sql`SELECT enabled FROM workflow_automation_activations
    WHERE map_id = ${automationMapId}`)[0].enabled, false);
  const [contract] = await sql`INSERT INTO contracts (organization_id, client_id, object_id, contract_number, status,
    starts_on, ends_on, renewal_notice_days) VALUES (${owner.organizationId}, ${client.id}, ${object.id},
    'WF-CONTRACT-001', 'draft', '2026-01-01', '2026-12-31', 30) RETURNING id`;
  const [foreignClient] = await sql`INSERT INTO clients (organization_id, legal_name)
    VALUES (${other.organizationId}, 'Чужой клиент') RETURNING id`;
  const contextMapId = randomUUID();
  await workflow.createWorkflowMap(owner, { id: contextMapId, title: 'Процесс с контекстом' });
  const contextDraft = { ...draft, regulations: 'Общий порядок выполнения', nodes: [
    { ...firstNode, regulation: 'Проверить исходные данные', ownerMemberId: reviewer.memberId,
      resource: { kind: 'client', id: client.id } },
    { ...secondNode, resource: { kind: 'order', id: order.id } },
  ] };
  assert.equal(await workflow.saveWorkflowMap(owner, { id: contextMapId, expectedVersion: 1,
    title: 'Процесс с контекстом', description: '', draft: contextDraft }), 2);
  assert.deepEqual((await workflow.getWorkflowWorkspace(owner, contextMapId)).selected?.draft, contextDraft);
  const revokedClient = { ...owner, permissionOverrides: { 'clients.read': false } };
  const redacted = (await workflow.getWorkflowWorkspace(revokedClient, contextMapId)).selected;
  assert.equal(redacted?.contextEditable, false);
  assert.equal(redacted?.draft.nodes[0].resource, null);
  assert.equal(redacted?.draft.nodes[1].resource.id, order.id);
  assert.equal((await versions.getWorkflowRevision(revokedClient, { id: contextMapId, version: 2 })).draft.nodes[0].resource, null);
  await assert.rejects(workflow.saveWorkflowMap(revokedClient, { id: contextMapId, expectedVersion: 2,
    title: 'Стереть скрытую ссылку', description: '', draft: redacted.draft }), AuthorizationError);
  assert.deepEqual(await context.findWorkflowResources(owner, contextMapId, 'client', 'Клиент для'),
    [{ id: client.id, label: 'Клиент для процесса' }]);
  assert.deepEqual(await context.findWorkflowResources(owner, contextMapId, 'order', 'WF-TEST-001'),
    [{ id: order.id, label: 'WF-TEST-001' }]);
  assert.deepEqual(await context.findWorkflowResources(owner, contextMapId, 'contract', 'WF-CONTRACT'),
    [{ id: contract.id, label: 'WF-CONTRACT-001' }]);
  assert.deepEqual(await context.findWorkflowResources(revokedClient, contextMapId, 'client', ''), []);
  await assert.rejects(context.findWorkflowResources(other, contextMapId, 'client', ''), workflow.WorkflowMapNotFoundError);
  await assert.rejects(workflow.saveWorkflowMap(owner, { id: contextMapId, expectedVersion: 2,
    title: 'Чужая ссылка', description: '', draft: { ...contextDraft,
      nodes: [{ ...contextDraft.nodes[0], resource: { kind: 'client', id: foreignClient.id } }, contextDraft.nodes[1]] } }),
    (error) => error instanceof contextAccess.WorkflowContextTargetError && error.kind === 'resource');
  const commentId = randomUUID();
  await context.addWorkflowComment(reader, { id: commentId, mapId: contextMapId, body: 'Уточнить порядок проверки' });
  await context.addWorkflowComment(reader, { id: commentId, mapId: contextMapId, body: 'Уточнить порядок проверки' });
  assert.equal((await context.getWorkflowContext(owner, contextMapId)).comments[0].body, 'Уточнить порядок проверки');
  assert.equal((await sql`SELECT count(*)::integer AS count FROM workflow_comments WHERE map_id = ${contextMapId}`)[0].count, 1);
  await assert.rejects(sql`UPDATE workflow_comments SET body = 'Подмена' WHERE id = ${commentId}`);
  await assert.rejects(context.addWorkflowComment(other, { id: randomUUID(), mapId: contextMapId, body: 'Чужая карта' }), workflow.WorkflowMapNotFoundError);
  await assert.rejects(context.addWorkflowComment({ ...reader, permissionOverrides: { 'workflow.comment': false } },
    { id: randomUUID(), mapId: contextMapId, body: 'Нет права' }), AuthorizationError);
  for (let index = 0; index < 55; index++) {
    await sql`INSERT INTO workflow_comments (organization_id, map_id, id, body, author_id)
      VALUES (${owner.organizationId}, ${contextMapId}, ${randomUUID()}, ${`Комментарий ${index}`}, ${reader.memberId})`;
  }
  const firstComments = await context.listWorkflowComments(owner, contextMapId);
  assert.equal(firstComments.comments.length, 50);
  assert.equal(firstComments.hasMore, true);
  const olderComments = await context.listWorkflowComments(owner, contextMapId, firstComments.comments.at(-1).id);
  assert.equal(olderComments.comments.length, 6);
  assert.equal(olderComments.hasMore, false);
  assert.equal(new Set([...firstComments.comments, ...olderComments.comments].map((item) => item.id)).size, 56);
  await assert.rejects(context.listWorkflowComments(other, contextMapId), workflow.WorkflowMapNotFoundError);
  const limitedReviewer = await member('manager', owner.organizationId);
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${owner.organizationId}, ${limitedReviewer.memberId}, 'clients.read', false)`;
  await versions.requestWorkflowReview(owner, { id: contextMapId, expectedVersion: 2 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${contextMapId}
      AND recipient_member_id = ${limitedReviewer.memberId}`)[0].count, 0);
  await versions.approveWorkflowReview(reviewer, { id: contextMapId, expectedVersion: 2 });
  await versions.publishWorkflowRevision(owner, { id: contextMapId, expectedVersion: 2 });
  await workflow.saveWorkflowMap(owner, { id: contextMapId, expectedVersion: 2,
    title: 'Новый контекст', description: '', draft: { ...contextDraft, regulations: 'Новый порядок' } });
  assert.equal((await versions.getWorkflowRevision(owner, { id: contextMapId, version: 2 })).draft.regulations,
    'Общий порядок выполнения');
  assert.equal((await workflow.getWorkflowWorkspace(owner, contextMapId)).selected?.publishedVersion, 2);

  const collaborationMapId = randomUUID();
  await workflow.createWorkflowMap(owner, { id: collaborationMapId, title: 'Совместная карта' });
  assert.equal((await collaboration.getWorkflowCollaboration(owner, collaborationMapId)).watching, true);
  await collaboration.watchWorkflowMap(reader, collaborationMapId, true);
  await collaboration.watchWorkflowMap(reader, collaborationMapId, true);
  assert.equal((await collaboration.getWorkflowCollaboration(reader, collaborationMapId)).watching, true);
  await assert.rejects(collaboration.watchWorkflowMap(other, collaborationMapId, true),
    collaboration.WorkflowCollaborationMapNotFoundError);
  await workflow.saveWorkflowMap(owner, { id: collaborationMapId, expectedVersion: 1,
    title: 'Совместная карта', description: '', draft });
  let readerNotifications = await notifications.listNotifications(reader, { limit: 100, unreadOnly: false });
  assert.equal(readerNotifications.items.some((item) => item.kind === 'workflow_update'
    && item.href === `/workflow?map=${collaborationMapId}`), true);
  const workflowNotice = readerNotifications.items.find((item) => item.sourceId === collaborationMapId);
  await assert.rejects(notifications.markNotificationRead({ ...reader,
    permissionOverrides: { 'workflow.read': false } }, workflowNotice.id), notifications.NotificationNotFoundError);
  assert.equal((await notifications.listNotifications({ ...reader, permissionOverrides: { 'workflow.read': false } },
    { limit: 100, unreadOnly: false })).items.some((item) => item.sourceId === collaborationMapId), false);
  await versions.requestWorkflowReview(owner, { id: collaborationMapId, expectedVersion: 2 });
  assert.equal((await notifications.listNotifications(reviewer, { limit: 100, unreadOnly: false })).items
    .some((item) => item.sourceId === collaborationMapId && item.title === 'Карта ждёт согласования'), true);
  await versions.approveWorkflowReview(reviewer, { id: collaborationMapId, expectedVersion: 2 });
  assert.equal((await notifications.listNotifications(owner, { limit: 100, unreadOnly: false })).items
    .some((item) => item.sourceId === collaborationMapId && item.title === 'Версия карты согласована'), true);
  await versions.publishWorkflowRevision(owner, { id: collaborationMapId, expectedVersion: 2 });
  assert.equal((await collaboration.getWorkflowCollaboration(reviewer, collaborationMapId)).watching, false);
  await context.addWorkflowComment(reader, { id: randomUUID(), mapId: collaborationMapId,
    body: 'Проверим уведомления всем участникам' });
  assert.equal((await notifications.listNotifications(owner, { limit: 100, unreadOnly: false })).items
    .some((item) => item.sourceId === collaborationMapId && item.title === 'Новое обсуждение карты'), true);
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${reader.organizationId}, ${reader.memberId}, 'workflow.read', false)`;
  const beforeRevokedSave = (await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${collaborationMapId} AND recipient_member_id = ${reader.memberId}`)[0].count;
  await workflow.saveWorkflowMap(owner, { id: collaborationMapId, expectedVersion: 2,
    title: 'Совместная карта', description: 'Новое описание', draft });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${collaborationMapId} AND recipient_member_id = ${reader.memberId}`)[0].count,
    beforeRevokedSave);
  await sql`DELETE FROM member_permission_overrides WHERE organization_id = ${reader.organizationId}
    AND member_id = ${reader.memberId} AND permission = 'workflow.read'`;
  await collaboration.watchWorkflowMap(reader, collaborationMapId, false);
  assert.equal((await collaboration.getWorkflowCollaboration(reader, collaborationMapId)).watching, false);
  readerNotifications = await notifications.listNotifications(reader, { limit: 100, unreadOnly: false });
  assert.equal(readerNotifications.items.some((item) => item.sourceId === collaborationMapId), true);
  const priorCount = (await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${collaborationMapId} AND recipient_member_id = ${reader.memberId}`)[0].count;
  await workflow.saveWorkflowMap(owner, { id: collaborationMapId, expectedVersion: 3,
    title: 'Совместная карта', description: 'Третья редакция', draft });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${collaborationMapId} AND recipient_member_id = ${reader.memberId}`)[0].count,
    priorCount);
  await workflow.archiveWorkflowMap(owner, { id: collaborationMapId, expectedVersion: 4 });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM notifications
    WHERE source_type = 'workflow' AND source_id = ${collaborationMapId} AND resolved_at IS NULL`)[0].count, 0);
});
