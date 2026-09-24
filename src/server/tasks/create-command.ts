import type postgres from "postgres";
import { z } from "zod";
import { requirePermission } from "../auth/permissions.ts";
import type { AuthenticatedMember } from "../auth/types.ts";
import { createTaskSchema, type CreateTaskInput } from "./schemas.ts";

const uuid = z.string().uuid();

export class TaskCreateTargetError extends Error {
  readonly reason: "assignee" | "order" | "idempotency";
  constructor(reason: TaskCreateTargetError["reason"]) {
    super(`Task creation target is invalid: ${reason}.`);
    this.name = "TaskCreateTargetError";
    this.reason = reason;
  }
}

// One task-domain command is shared by the form and the Workflow worker.
// The caller supplies a transaction so a Workflow run commits all actions or none.
export async function createTaskInTransaction(transaction: postgres.TransactionSql,
  member: AuthenticatedMember, rawInput: CreateTaskInput, source: "manual" | "workflow",
  workflowContext?: { mapId: string; version: number; jobId: string; nodeId: string }) {
  requirePermission(member, "tasks.write");
  const input = createTaskSchema.parse({ ...rawInput,
    description: rawInput.description ?? "", assignedMemberId: rawInput.assignedMemberId ?? "",
    relatedOrderId: rawInput.relatedOrderId ?? "" });
  if (source === "workflow" && (!workflowContext || !input.relatedOrderId)) throw new TaskCreateTargetError("order");
  if (input.assignedMemberId) {
    const assignee = await transaction`SELECT id FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMemberId} AND active
      FOR KEY SHARE`;
    if (!assignee.length) throw new TaskCreateTargetError("assignee");
  }
  if (input.relatedOrderId) {
    const orders = await transaction`SELECT id FROM orders
      WHERE organization_id = ${member.organizationId} AND id = ${input.relatedOrderId} AND status <> 'cancelled'
      FOR KEY SHARE`;
    if (!orders.length) throw new TaskCreateTargetError("order");
  }
  const [due] = input.localDate && input.localTime
    ? await transaction`SELECT ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS due_at
        FROM organizations WHERE id = ${member.organizationId}`
    : [{ due_at: null }];
  const inserted = await transaction`INSERT INTO tasks (
    organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, source,
    idempotency_key, created_by, updated_by
  ) VALUES (
    ${member.organizationId}, ${input.title}, ${input.description}, ${input.priority}, ${due?.due_at ?? null},
    ${input.assignedMemberId}, ${input.relatedOrderId}, ${source}, ${input.idempotencyKey}, ${member.memberId}, ${member.memberId}
  ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING id`;
  if (!inserted.length) {
    const [existing] = await transaction`SELECT id, source, title, description, priority,
      assigned_member_id, related_order_id, due_at FROM tasks
      WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    if (!existing || existing.source !== source || existing.title !== input.title
      || existing.description !== input.description || existing.priority !== input.priority
      || existing.assigned_member_id !== input.assignedMemberId
      || existing.related_order_id !== input.relatedOrderId
      || (existing.due_at ? z.coerce.date().parse(existing.due_at).getTime() : null)
        !== (due?.due_at ? z.coerce.date().parse(due.due_at).getTime() : null)) {
      throw new TaskCreateTargetError("idempotency");
    }
    return uuid.parse(existing.id);
  }
  const taskId = uuid.parse(inserted[0].id);
  const createdState = {
    title: input.title, description: input.description, priority: input.priority,
    dueAt: due?.due_at ?? null, assignedMemberId: input.assignedMemberId,
    relatedOrderId: input.relatedOrderId, status: "open", source, version: 1,
    ...(workflowContext ? { workflow: workflowContext } : {}),
  };
  await transaction`INSERT INTO task_events (organization_id, task_id, actor_id, event_type, after_state)
    VALUES (${member.organizationId}, ${taskId}, ${member.memberId}, 'created', ${transaction.json(createdState)})`;
  await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
    VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
      ${source === "manual" ? "task.create" : "task.create.workflow"}, 'task', ${taskId},
      ${transaction.json(createdState)})`;
  return taskId;
}
