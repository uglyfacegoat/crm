import "server-only";
import { z } from "zod";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { compileOrderCreatedPlan, type WorkflowTaskPlan } from "./automation-plan";
import { canEditWorkflowContext } from "./context-access";
import { WorkflowMapNotFoundError } from "./repository";
import { workflowDraftSchema } from "./schemas";

const uuid = z.string().uuid();
const publishedRow = z.object({ published_version: z.number().int().positive().nullable() });
const orderRow = z.object({ order_number: z.string(), status: z.string() });

export class WorkflowAutomationTargetError extends Error {
  readonly reason: "unpublished" | "order_unavailable" | "assignee_unavailable";
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

export async function previewOrderCreatedAutomation(member: AuthenticatedMember, mapId: string, orderId: string): Promise<WorkflowAutomationPreview> {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.publish");
  requirePermission(member, "orders.read");
  requirePermission(member, "tasks.write");
  const sql = getDatabase();
  const [mapData] = await sql`SELECT published_version FROM workflow_maps
    WHERE organization_id = ${member.organizationId} AND id = ${mapId} AND archived_at IS NULL`;
  if (!mapData) throw new WorkflowMapNotFoundError();
  const map = publishedRow.parse(mapData);
  if (map.published_version === null) throw new WorkflowAutomationTargetError("unpublished");
  const [revision] = await sql`SELECT draft FROM workflow_map_revisions
    WHERE organization_id = ${member.organizationId} AND map_id = ${mapId}
      AND version = ${map.published_version}`;
  if (!revision) throw new WorkflowAutomationTargetError("unpublished");
  const draft = workflowDraftSchema.parse(revision.draft);
  if (!canEditWorkflowContext(member, draft)) throw new AuthorizationError();
  const tasks = compileOrderCreatedPlan(draft);
  const [orderData] = await sql`SELECT order_number, status FROM orders
    WHERE organization_id = ${member.organizationId} AND id = ${orderId}`;
  if (!orderData) throw new WorkflowAutomationTargetError("order_unavailable");
  const order = orderRow.parse(orderData);
  if (order.status === "cancelled") throw new WorkflowAutomationTargetError("order_unavailable");
  const assigned = [...new Set(tasks.map((task) => task.assignedMemberId).filter((id): id is string => id !== null))];
  for (const id of assigned) {
    const [person] = await sql`SELECT id FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${id} AND active`;
    if (!person) throw new WorkflowAutomationTargetError("assignee_unavailable");
  }
  return { mapVersion: map.published_version, orderId: uuid.parse(orderId), orderNumber: order.order_number, tasks };
}
