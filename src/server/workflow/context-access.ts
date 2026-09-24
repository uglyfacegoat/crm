import "server-only";
import type postgres from "postgres";
import { AuthorizationError, hasPermission, type Permission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import type { WorkflowDraft, WorkflowNode } from "./schemas";

const resourcePermissions = {
  client: "clients.read",
  order: "orders.read",
  contract: "contracts.read",
} as const satisfies Record<NonNullable<WorkflowNode["resource"]>["kind"], Permission>;

export class WorkflowContextTargetError extends Error {
  constructor(public readonly kind: "owner" | "resource") {
    super(`Workflow ${kind} target is unavailable.`);
    this.name = "WorkflowContextTargetError";
  }
}

export function canReadWorkflowResource(member: Pick<AuthenticatedMember, "role" | "permissionOverrides">, resource: NonNullable<WorkflowNode["resource"]>) {
  return hasPermission(member, resourcePermissions[resource.kind]);
}

export function canEditWorkflowContext(member: Pick<AuthenticatedMember, "role" | "permissionOverrides">, draft: WorkflowDraft) {
  return draft.nodes.every((node) => !node.resource || canReadWorkflowResource(member, node.resource));
}

export function visibleWorkflowDraft(member: Pick<AuthenticatedMember, "role" | "permissionOverrides">, draft: WorkflowDraft): WorkflowDraft {
  return { ...draft, nodes: draft.nodes.map((node) => node.resource && !canReadWorkflowResource(member, node.resource)
    ? { ...node, resource: null } : node) };
}

export async function validateWorkflowContext(transaction: postgres.TransactionSql, member: AuthenticatedMember, draft: WorkflowDraft) {
  for (const node of draft.nodes) {
    if (node.ownerMemberId) {
      const [owner] = await transaction`SELECT id FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${node.ownerMemberId}`;
      if (!owner) throw new WorkflowContextTargetError("owner");
    }
    if (!node.resource) continue;
    if (!canReadWorkflowResource(member, node.resource)) throw new AuthorizationError();
    const { kind, id } = node.resource;
    const [target] = kind === "client"
      ? await transaction`SELECT id FROM clients WHERE organization_id = ${member.organizationId} AND id = ${id}`
      : kind === "order"
        ? await transaction`SELECT id FROM orders WHERE organization_id = ${member.organizationId} AND id = ${id}`
        : await transaction`SELECT id FROM contracts WHERE organization_id = ${member.organizationId} AND id = ${id}`;
    if (!target) throw new WorkflowContextTargetError("resource");
  }
}
