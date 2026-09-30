import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import { AuthorizationError, hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { compileOrderCreatedPlan, type WorkflowTaskPlan } from "./automation-plan";
import { canEditWorkflowContext } from "./context-access";
import { WorkflowMapNotFoundError } from "./repository";
import { workflowDraftSchema } from "./schemas";

const uuid = z.string().uuid();
const publishedRow = z.object({ published_version: z.number().int().positive().nullable() });
const orderRow = z.object({ order_number: z.string(), status: z.string() });
const activationRow = z.object({ activation_id: uuid, version: z.number().int().positive(), enabled: z.boolean() });
const jobStatusRow = z.object({ id: uuid, order_number: z.string(), version: z.number().int().positive(),
  status: z.enum(["pending", "running", "succeeded", "failed", "stopped"]),
  attempts: z.number().int().min(0).max(3), last_error_code: z.string().nullable(), created_at: z.coerce.date() });

export class WorkflowAutomationTargetError extends Error {
  readonly reason: "unpublished" | "order_unavailable" | "assignee_unavailable" | "version_changed" | "trial_required";
  constructor(reason: WorkflowAutomationTargetError["reason"]) {
    super(`Workflow automation target is unavailable: ${reason}.`);
    this.name = "WorkflowAutomationTargetError";
    this.reason = reason;
  }
}

export type WorkflowAutomationPreview = {
  mapVersion: number;
  orderId: string;
  orderNumber: string;
  tasks: WorkflowTaskPlan[];
};

async function ensureActiveAssignees(transaction: postgres.TransactionSql, organizationId: string, tasks: WorkflowTaskPlan[]) {
  const assigned = [...new Set(tasks.map((task) => task.assignedMemberId).filter((id): id is string => id !== null))];
  for (const id of assigned) {
    const [person] = await transaction`SELECT id FROM organization_members
      WHERE organization_id = ${organizationId} AND id = ${id} AND active FOR KEY SHARE`;
    if (!person) throw new WorkflowAutomationTargetError("assignee_unavailable");
  }
}

export async function previewOrderCreatedAutomation(member: AuthenticatedMember, mapId: string, orderId: string): Promise<WorkflowAutomationPreview> {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.publish");
  requirePermission(member, "orders.read");
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  const validOrderId = uuid.parse(orderId);
  return sql.begin(async (transaction) => {
    const [mapData] = await transaction`SELECT published_version FROM workflow_maps
      WHERE organization_id = ${member.organizationId} AND id = ${mapId} AND archived_at IS NULL`;
    if (!mapData) throw new WorkflowMapNotFoundError();
    const map = publishedRow.parse(mapData);
    if (map.published_version === null) throw new WorkflowAutomationTargetError("unpublished");
    const [revision] = await transaction`SELECT draft FROM workflow_map_revisions
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}
        AND version = ${map.published_version}`;
    if (!revision) throw new WorkflowAutomationTargetError("unpublished");
    const draft = workflowDraftSchema.parse(revision.draft);
    if (!canEditWorkflowContext(member, draft)) throw new AuthorizationError();
    const tasks = compileOrderCreatedPlan(draft);
    const [orderData] = await transaction`SELECT order_number, status FROM orders
      WHERE organization_id = ${member.organizationId} AND id = ${validOrderId}`;
    if (!orderData) throw new WorkflowAutomationTargetError("order_unavailable");
    const order = orderRow.parse(orderData);
    if (order.status === "cancelled") throw new WorkflowAutomationTargetError("order_unavailable");
    await ensureActiveAssignees(transaction, member.organizationId, tasks);
    await transaction`INSERT INTO workflow_automation_trials
      (organization_id, map_id, version, member_id, order_id, validated_at)
      VALUES (${member.organizationId}, ${mapId}, ${map.published_version},
        ${member.memberId}, ${validOrderId}, now())
      ON CONFLICT (organization_id, map_id, version, member_id) DO UPDATE SET
        order_id = EXCLUDED.order_id, validated_at = now()`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.automation.trial', 'workflow_map', ${mapId},
        ${transaction.json({ version: map.published_version, orderId: validOrderId, actions: tasks.length })})`;
    return { mapVersion: map.published_version, orderId: validOrderId, orderNumber: order.order_number, tasks };
  });
}

export async function getWorkflowAutomationState(member: AuthenticatedMember, mapId: string) {
  requirePermission(member, "workflow.read");
  if (!hasPermission(member, "orders.read")) return { activeVersion: null, trialReady: false, jobs: [] };
  const sql = getDatabase();
  const [[activationData], [trialData]] = await Promise.all([
    sql`SELECT version, enabled FROM workflow_automation_activations
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}`,
    sql`SELECT trial.validated_at FROM workflow_automation_trials trial
      JOIN workflow_maps map ON map.organization_id = trial.organization_id
        AND map.id = trial.map_id AND map.published_version = trial.version
      WHERE trial.organization_id = ${member.organizationId} AND trial.map_id = ${mapId}
        AND trial.member_id = ${member.memberId}
        AND trial.validated_at > now() - interval '24 hours'`,
  ]);
  const rows = await sql`SELECT job.id, orders.order_number, job.version, job.status,
      job.attempts, job.last_error_code, job.created_at
    FROM workflow_automation_jobs job JOIN orders
      ON orders.organization_id = job.organization_id AND orders.id = job.order_id
    WHERE job.organization_id = ${member.organizationId} AND job.map_id = ${mapId}
    ORDER BY job.created_at DESC, job.id DESC LIMIT 10`;
  return { activeVersion: activationData?.enabled ? z.number().int().positive().parse(activationData.version) : null,
    trialReady: Boolean(trialData),
    jobs: z.array(jobStatusRow).parse(rows).map((row) => ({ id: row.id, orderNumber: row.order_number,
      version: row.version, status: row.status, attempts: row.attempts,
      errorCode: row.last_error_code, createdAt: row.created_at.toISOString() })) };
}

export type WorkflowAutomationState = Awaited<ReturnType<typeof getWorkflowAutomationState>>;

export async function enableOrderCreatedAutomation(member: AuthenticatedMember, mapId: string, expectedPublishedVersion: number) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.publish");
  requirePermission(member, "orders.read");
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [map] = await transaction`SELECT published_version FROM workflow_maps
      WHERE organization_id = ${member.organizationId} AND id = ${mapId}
        AND archived_at IS NULL FOR UPDATE`;
    if (!map) throw new WorkflowMapNotFoundError();
    const version = publishedRow.parse(map).published_version;
    if (version === null) throw new WorkflowAutomationTargetError("unpublished");
    if (version !== expectedPublishedVersion) throw new WorkflowAutomationTargetError("version_changed");
    const [revision] = await transaction`SELECT draft FROM workflow_map_revisions
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId} AND version = ${version}`;
    if (!revision) throw new WorkflowAutomationTargetError("unpublished");
    const draft = workflowDraftSchema.parse(revision.draft);
    if (!canEditWorkflowContext(member, draft)) throw new AuthorizationError();
    const plan = compileOrderCreatedPlan(draft);
    await ensureActiveAssignees(transaction, member.organizationId, plan);
    const [trial] = await transaction`SELECT validated_at FROM workflow_automation_trials
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}
        AND version = ${version} AND member_id = ${member.memberId}
        AND validated_at > now() - interval '24 hours'`;
    if (!trial) throw new WorkflowAutomationTargetError("trial_required");
    const [existingData] = await transaction`SELECT activation_id, version, enabled
      FROM workflow_automation_activations
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId} FOR UPDATE`;
    const existing = existingData ? activationRow.parse(existingData) : null;
    if (existing?.enabled && existing.version === version) return version;
    if (existing?.enabled) {
      await transaction`UPDATE workflow_automation_jobs SET status = 'stopped',
        lease_until = NULL, completed_at = now()
        WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}
          AND activation_id = ${existing.activation_id} AND status IN ('pending', 'running')`;
    }
    const activationId = randomUUID();
    await transaction`INSERT INTO workflow_automation_activations
      (organization_id, map_id, activation_id, version, enabled, enabled_by,
       enabled_at, stopped_by, stopped_at)
      VALUES (${member.organizationId}, ${mapId}, ${activationId}, ${version}, true,
        ${member.memberId}, now(), NULL, NULL)
      ON CONFLICT (organization_id, map_id) DO UPDATE SET
        activation_id = EXCLUDED.activation_id, version = EXCLUDED.version,
        enabled = true, enabled_by = EXCLUDED.enabled_by, enabled_at = now(),
        stopped_by = NULL, stopped_at = NULL`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.automation.enable', 'workflow_map', ${mapId},
        ${transaction.json({ version, activationId, actions: plan.length })})`;
    return version;
  });
}

export async function stopOrderCreatedAutomation(member: AuthenticatedMember, mapId: string) {
  if (!hasPermission(member, "workflow.publish") && !hasPermission(member, "settings.write")) throw new AuthorizationError();
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [map] = await transaction`SELECT id FROM workflow_maps
      WHERE organization_id = ${member.organizationId} AND id = ${mapId}`;
    if (!map) throw new WorkflowMapNotFoundError();
    const [existingData] = await transaction`SELECT activation_id, version, enabled
      FROM workflow_automation_activations
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId} FOR UPDATE`;
    if (!existingData) return false;
    const existing = activationRow.parse(existingData);
    if (!existing.enabled) return false;
    await transaction`UPDATE workflow_automation_activations SET enabled = false,
      stopped_by = ${member.memberId}, stopped_at = now()
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}`;
    await transaction`UPDATE workflow_automation_jobs SET status = 'stopped',
      lease_until = NULL, completed_at = now()
      WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}
        AND activation_id = ${existing.activation_id} AND status IN ('pending', 'running')`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.automation.stop', 'workflow_map', ${mapId},
        ${transaction.json({ version: existing.version, activationId: existing.activation_id })})`;
    return true;
  });
}
