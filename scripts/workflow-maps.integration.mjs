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
    return { organizationId: organization.id, memberId: id, role, permissionOverrides: {}, sessionId: null };
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
});
