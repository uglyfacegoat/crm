import assert from "node:assert/strict";
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
  assert.deepEqual(await context.findWorkflowResources(owner, contextMapId, 'order', 'WF-TEST'),
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
