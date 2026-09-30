import type { WorkflowDraft } from "./schemas.ts";

export type WorkflowTaskPlan = {
  nodeId: string;
  title: string;
  priority: "low" | "normal" | "high" | "critical";
  assignedMemberId: string | null;
};

export class WorkflowAutomationPlanError extends Error {
  readonly reason: "missing_trigger" | "multiple_triggers" | "missing_action" | "too_many_actions" | "unsupported_connection";
  constructor(reason: WorkflowAutomationPlanError["reason"]) {
    super(`Workflow automation plan is invalid: ${reason}.`);
    this.name = "WorkflowAutomationPlanError";
    this.reason = reason;
  }
}

// The executable subset is deliberately explicit. Other visual blocks remain documentation.
// No text in titles/descriptions/edge labels is interpreted as a command or condition.
export function compileOrderCreatedPlan(draft: WorkflowDraft): WorkflowTaskPlan[] {
  const triggers = draft.nodes.filter((node) => node.automation?.kind === "order_created");
  if (triggers.length === 0) throw new WorkflowAutomationPlanError("missing_trigger");
  if (triggers.length !== 1) throw new WorkflowAutomationPlanError("multiple_triggers");
  const trigger = triggers[0];
  const actions = draft.nodes.filter((node) => node.automation?.kind === "create_order_task");
  if (actions.length === 0) throw new WorkflowAutomationPlanError("missing_action");
  if (actions.length > 5) throw new WorkflowAutomationPlanError("too_many_actions");
  const actionIds = new Set(actions.map((node) => node.id));
  const automationIds = new Set([trigger.id, ...actionIds]);
  const connected = new Set<string>();
  for (const edge of draft.edges) {
    if (!automationIds.has(edge.sourceId) && !automationIds.has(edge.targetId)) continue;
    if (edge.sourceId !== trigger.id || !actionIds.has(edge.targetId)) {
      throw new WorkflowAutomationPlanError("unsupported_connection");
    }
    connected.add(edge.targetId);
  }
  if (connected.size !== actions.length) throw new WorkflowAutomationPlanError("unsupported_connection");
  return actions.map((node) => {
    const automation = node.automation;
    if (automation?.kind !== "create_order_task") throw new WorkflowAutomationPlanError("unsupported_connection");
    return { nodeId: node.id, title: automation.title, priority: automation.priority,
      assignedMemberId: automation.assignedMemberId };
  });
}
