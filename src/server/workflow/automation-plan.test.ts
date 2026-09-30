import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { compileOrderCreatedPlan, WorkflowAutomationPlanError } from "./automation-plan.ts";
import { workflowDraftSchema } from "./schemas.ts";

const trigger = { id: randomUUID(), kind: "event" as const, title: "Заказ создан", description: "", x: 0, y: 0,
  automation: { kind: "order_created" as const } };
const action = { id: randomUUID(), kind: "action" as const, title: "Создать задачу", description: "", x: 250, y: 0,
  automation: { kind: "create_order_task" as const, title: "Проверить новый заказ", priority: "normal" as const, assignedMemberId: null } };
const edge = { id: randomUUID(), sourceId: trigger.id, targetId: action.id, label: "" };

test("only an explicit, direct order-created to task action compiles", () => {
  const draft = workflowDraftSchema.parse({ nodes: [trigger, action], edges: [edge] });
  assert.deepEqual(compileOrderCreatedPlan(draft), [{ nodeId: action.id, title: "Проверить новый заказ",
    priority: "normal", assignedMemberId: null }]);
  assert.equal(workflowDraftSchema.safeParse({ nodes: [{ ...action, kind: "note" }], edges: [] }).success, false);
  assert.equal(workflowDraftSchema.safeParse({ nodes: [{ ...action, automation: { kind: "create_order_task", title: "x", priority: "normal", assignedMemberId: null, sql: "DELETE" } }], edges: [] }).success, false);
});

test("unsupported graphs fail closed", () => {
  const notes = { id: randomUUID(), kind: "note" as const, title: "Памятка", description: "", x: 0, y: 200 };
  const expectReason = (nodes: unknown[], edges: unknown[], reason: string) => {
    const draft = workflowDraftSchema.parse({ nodes, edges });
    assert.throws(() => compileOrderCreatedPlan(draft),
      (error) => error instanceof WorkflowAutomationPlanError && error.reason === reason);
  };
  expectReason([notes], [], "missing_trigger");
  expectReason([trigger, { ...trigger, id: randomUUID() }, action], [edge], "multiple_triggers");
  expectReason([trigger, notes], [], "missing_action");
  expectReason([trigger, action], [], "unsupported_connection");
  expectReason([trigger, action, notes], [{ ...edge, targetId: notes.id }], "unsupported_connection");
  expectReason([trigger, action, notes], [edge, { id: randomUUID(), sourceId: action.id, targetId: notes.id, label: "" }], "unsupported_connection");
});
