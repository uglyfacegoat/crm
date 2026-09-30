import { createHash } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { hasPermission } from "../auth/permissions.ts";
import type { AuthenticatedMember } from "../auth/types.ts";
import { createTaskInTransaction, TaskCreateTargetError } from "../tasks/create-command.ts";
import { compileOrderCreatedPlan } from "./automation-plan.ts";
import { workflowDraftSchema } from "./schemas.ts";

const uuid = z.string().uuid();
const jobRow = z.object({ id: uuid, organization_id: uuid, map_id: uuid,
  activation_id: uuid, version: z.number().int().positive(), order_id: uuid,
  status: z.enum(["pending", "running", "succeeded", "failed", "stopped"]),
  attempts: z.number().int().min(0).max(3) });
const activationRow = z.object({ activation_id: uuid, version: z.number().int().positive(),
  enabled: z.boolean(), enabled_by: uuid });
const memberRow = z.object({ id: uuid, organization_id: uuid, organization_name: z.string(),
  display_name: z.string(), email: z.string(), role: z.enum(["owner", "developer", "admin", "dispatcher", "manager", "deputy", "finance_controller", "sales_lead", "regional_director", "crm_coordinator", "tender_specialist", "foreman", "accountant", "master"]),
  master_id: uuid.nullable(), permission_overrides: z.record(z.string(), z.boolean()), active: z.boolean() });

export class WorkflowJobPermanentError extends Error {
  readonly code: "ACTIVATION_STOPPED" | "MAP_UNAVAILABLE" | "ACTOR_UNAVAILABLE" | "ACTOR_PERMISSION_REVOKED" | "ORDER_UNAVAILABLE" | "INVALID_PLAN" | "INVALID_TASK_TARGET";
  constructor(code: WorkflowJobPermanentError["code"]) {
    super(`Workflow job cannot continue: ${code}.`);
    this.name = "WorkflowJobPermanentError";
    this.code = code;
  }
}

export function workflowTaskIdempotencyKey(jobId: string, nodeId: string) {
  const hash = createHash("sha256").update(`workflow-task:${jobId}:${nodeId}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function claimWorkflowJob(sql: postgres.Sql) {
  return sql.begin(async (transaction) => {
    const [claimed] = await transaction`WITH due AS (
        SELECT id FROM workflow_automation_jobs
        WHERE attempts < 3 AND (
          (status = 'pending' AND next_attempt_at <= now())
          OR (status = 'running' AND lease_until <= now())
        ) ORDER BY next_attempt_at, created_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE workflow_automation_jobs job SET status = 'running',
        attempts = attempts + 1, lease_until = now() + interval '90 seconds',
        last_error_code = NULL
      FROM due WHERE job.id = due.id
      RETURNING job.id, job.organization_id, job.map_id, job.activation_id,
        job.version, job.order_id, job.status, job.attempts`;
    return claimed ? jobRow.parse(claimed) : null;
  });
}

export async function executeWorkflowJob(sql: postgres.Sql, claimed: NonNullable<Awaited<ReturnType<typeof claimWorkflowJob>>>) {
  return sql.begin(async (transaction) => {
    // Lock activation before the job: stop and execution use the same order.
    const [activationData] = await transaction`SELECT activation_id, version, enabled, enabled_by
      FROM workflow_automation_activations
      WHERE organization_id = ${claimed.organization_id} AND map_id = ${claimed.map_id}
      FOR SHARE`;
    const [jobData] = await transaction`SELECT id, organization_id, map_id, activation_id,
        version, order_id, status, attempts FROM workflow_automation_jobs
      WHERE id = ${claimed.id} FOR UPDATE`;
    if (!jobData) return { status: "skipped" as const, taskIds: [] as string[] };
    const job = jobRow.parse(jobData);
    if (job.status !== "running" || job.attempts !== claimed.attempts) return { status: "skipped" as const, taskIds: [] as string[] };
    if (!activationData) throw new WorkflowJobPermanentError("ACTIVATION_STOPPED");
    const activation = activationRow.parse(activationData);
    if (!activation.enabled || activation.activation_id !== job.activation_id || activation.version !== job.version) {
      await transaction`UPDATE workflow_automation_jobs SET status = 'stopped', lease_until = NULL,
        completed_at = now() WHERE id = ${job.id}`;
      return { status: "stopped" as const, taskIds: [] as string[] };
    }
    const [map] = await transaction`SELECT id FROM workflow_maps WHERE organization_id = ${job.organization_id}
      AND id = ${job.map_id} AND archived_at IS NULL`;
    if (!map) throw new WorkflowJobPermanentError("MAP_UNAVAILABLE");
    const [revision] = await transaction`SELECT draft FROM workflow_map_revisions
      WHERE organization_id = ${job.organization_id} AND map_id = ${job.map_id} AND version = ${job.version}`;
    if (!revision) throw new WorkflowJobPermanentError("MAP_UNAVAILABLE");
    const draft = workflowDraftSchema.parse(revision.draft);
    let plan;
    try { plan = compileOrderCreatedPlan(draft); }
    catch { throw new WorkflowJobPermanentError("INVALID_PLAN"); }
    const [memberData] = await transaction`SELECT member.id, member.organization_id,
        organization.name AS organization_name, member.display_name, member.email,
        member.role, member.master_id, member.active,
        coalesce(overrides.values, '{}'::jsonb) AS permission_overrides
      FROM organization_members member
      JOIN organizations organization ON organization.id = member.organization_id
      LEFT JOIN LATERAL (
        SELECT jsonb_object_agg(permission, allowed) AS values FROM member_permission_overrides
        WHERE organization_id = member.organization_id AND member_id = member.id
      ) overrides ON true
      WHERE member.organization_id = ${job.organization_id} AND member.id = ${activation.enabled_by}`;
    if (!memberData) throw new WorkflowJobPermanentError("ACTOR_UNAVAILABLE");
    const actor = memberRow.parse(memberData);
    if (!actor.active) throw new WorkflowJobPermanentError("ACTOR_UNAVAILABLE");
    const subject = { role: actor.role, permissionOverrides: actor.permission_overrides };
    if (!["workflow.read", "workflow.publish", "orders.read", "tasks.write"].every((permission) =>
      hasPermission(subject, permission as Parameters<typeof hasPermission>[1]))) {
      throw new WorkflowJobPermanentError("ACTOR_PERMISSION_REVOKED");
    }
    const [order] = await transaction`SELECT id FROM orders
      WHERE organization_id = ${job.organization_id} AND id = ${job.order_id} AND status <> 'cancelled'`;
    if (!order) throw new WorkflowJobPermanentError("ORDER_UNAVAILABLE");
    const member: AuthenticatedMember = {
      sessionId: null, organizationId: actor.organization_id,
      organizationName: actor.organization_name, memberId: actor.id,
      displayName: actor.display_name, email: actor.email, role: actor.role,
      masterId: actor.master_id, permissionOverrides: actor.permission_overrides,
    };
    const taskIds: string[] = [];
    for (const action of plan) {
      try {
        taskIds.push(await createTaskInTransaction(transaction, member, {
          idempotencyKey: workflowTaskIdempotencyKey(job.id, action.nodeId),
          relatedOrderId: job.order_id, title: action.title, description: null,
          priority: action.priority, assignedMemberId: action.assignedMemberId,
          localDate: "", localTime: "",
        }, "workflow", { mapId: job.map_id, version: job.version, jobId: job.id, nodeId: action.nodeId }));
      } catch (error) {
        if (error instanceof TaskCreateTargetError) throw new WorkflowJobPermanentError("INVALID_TASK_TARGET");
        throw error;
      }
    }
    await transaction`UPDATE workflow_automation_jobs SET status = 'succeeded',
      lease_until = NULL, completed_at = now(), last_error_code = NULL
      WHERE id = ${job.id}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, action, entity_type, entity_id, changes)
      VALUES (${job.organization_id}, ${actor.id}, 'workflow.automation.succeeded',
        'workflow_map', ${job.map_id},
        ${transaction.json({ jobId: job.id, version: job.version, orderId: job.order_id, taskIds })})`;
    return { status: "succeeded" as const, taskIds };
  });
}

export async function failWorkflowJob(sql: postgres.Sql, claimed: NonNullable<Awaited<ReturnType<typeof claimWorkflowJob>>>, error: unknown) {
  const errorCode = error instanceof WorkflowJobPermanentError ? error.code : "WORKFLOW_EXECUTION_FAILED";
  const terminal = error instanceof WorkflowJobPermanentError || claimed.attempts >= 3;
  return sql.begin(async (transaction) => {
    const [updated] = await transaction`UPDATE workflow_automation_jobs
      SET status = ${terminal ? "failed" : "pending"}, lease_until = NULL,
        completed_at = ${terminal ? new Date() : null},
        next_attempt_at = CASE WHEN ${terminal} THEN next_attempt_at
          ELSE now() + (CASE attempts WHEN 1 THEN interval '30 seconds'
            ELSE interval '2 minutes' END) END,
        last_error_code = ${errorCode}
      WHERE id = ${claimed.id} AND status = 'running' AND attempts = ${claimed.attempts}
      RETURNING id`;
    if (!updated) return false;
    await transaction`INSERT INTO audit_events
      (organization_id, action, entity_type, entity_id, changes)
      VALUES (${claimed.organization_id}, 'workflow.automation.attempt_failed',
        'workflow_map', ${claimed.map_id},
        ${transaction.json({ jobId: claimed.id, attempts: claimed.attempts, terminal, errorCode })})`;
    return true;
  });
}

export async function processWorkflowJobs(sql: postgres.Sql, limit = 10) {
  let succeeded = 0, failed = 0, stopped = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await claimWorkflowJob(sql);
    if (!job) break;
    try {
      const result = await executeWorkflowJob(sql, job);
      if (result.status === "succeeded") succeeded += 1;
      if (result.status === "stopped") stopped += 1;
    } catch (error) {
      if (await failWorkflowJob(sql, job, error)) failed += 1;
    }
  }
  return { succeeded, failed, stopped };
}
