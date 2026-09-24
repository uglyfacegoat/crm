import { z } from "zod";

const uuid = z.string().uuid();
const boundedText = (min: number, max: number) => z.string().trim().min(min).max(max);

export const workflowNodeSchema = z.object({
  id: uuid,
  kind: z.enum(["event", "crm_card", "condition", "action", "note"]),
  title: boundedText(2, 100),
  description: boundedText(0, 500),
  regulation: boundedText(0, 4000).optional(),
  ownerMemberId: uuid.nullable().optional(),
  resource: z.object({ kind: z.enum(["client", "order", "contract"]), id: uuid }).strict().nullable().optional(),
  x: z.number().int().min(0).max(5000),
  y: z.number().int().min(0).max(5000),
}).strict();

export const workflowEdgeSchema = z.object({
  id: uuid,
  sourceId: uuid,
  targetId: uuid,
  label: boundedText(0, 80),
}).strict();

export const workflowDraftSchema = z.object({
  nodes: z.array(workflowNodeSchema).max(60),
  edges: z.array(workflowEdgeSchema).max(120),
  regulations: boundedText(0, 8000).optional(),
}).strict().superRefine((draft, context) => {
  const nodeIds = new Set<string>();
  for (const node of draft.nodes) {
    if (nodeIds.has(node.id)) context.addIssue({ code: "custom", message: "Узлы не могут повторяться." });
    nodeIds.add(node.id);
  }
  const edgeIds = new Set<string>();
  const pairs = new Set<string>();
  for (const edge of draft.edges) {
    if (edgeIds.has(edge.id)) context.addIssue({ code: "custom", message: "Связи не могут повторяться." });
    edgeIds.add(edge.id);
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId) || edge.sourceId === edge.targetId) {
      context.addIssue({ code: "custom", message: "Связь должна соединять два разных узла карты." });
    }
    const pair = `${edge.sourceId}:${edge.targetId}`;
    if (pairs.has(pair)) context.addIssue({ code: "custom", message: "Такая связь уже существует." });
    pairs.add(pair);
  }
});

export const createWorkflowMapSchema = z.object({
  id: uuid,
  title: boundedText(2, 120),
}).strict();

export const saveWorkflowMapSchema = z.object({
  id: uuid,
  expectedVersion: z.number().int().positive(),
  title: boundedText(2, 120),
  description: boundedText(0, 1000),
  draft: workflowDraftSchema,
}).strict();

export const archiveWorkflowMapSchema = z.object({
  id: uuid,
  expectedVersion: z.number().int().positive(),
}).strict();

export const workflowVersionCommandSchema = archiveWorkflowMapSchema;
export const rejectWorkflowReviewSchema = workflowVersionCommandSchema.extend({
  reason: boundedText(2, 500),
}).strict();
export const restoreWorkflowRevisionSchema = workflowVersionCommandSchema.extend({
  sourceVersion: z.number().int().positive(),
}).strict();
export const workflowRevisionLookupSchema = z.object({
  id: uuid,
  version: z.number().int().positive(),
}).strict();

export const addWorkflowCommentSchema = z.object({
  id: uuid,
  mapId: uuid,
  body: boundedText(2, 2000),
}).strict();
export const workflowResourceSearchSchema = z.object({
  mapId: uuid,
  kind: z.enum(["client", "order", "contract"]),
  query: boundedText(0, 100),
}).strict();
export const workflowCommentPageSchema = z.object({ mapId: uuid, beforeId: uuid }).strict();

export type WorkflowDraft = z.infer<typeof workflowDraftSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;
export type CreateWorkflowMapInput = z.infer<typeof createWorkflowMapSchema>;
export type SaveWorkflowMapInput = z.infer<typeof saveWorkflowMapSchema>;
export type ArchiveWorkflowMapInput = z.infer<typeof archiveWorkflowMapSchema>;
export type WorkflowVersionCommandInput = z.infer<typeof workflowVersionCommandSchema>;
export type RejectWorkflowReviewInput = z.infer<typeof rejectWorkflowReviewSchema>;
export type RestoreWorkflowRevisionInput = z.infer<typeof restoreWorkflowRevisionSchema>;
export type WorkflowRevisionLookupInput = z.infer<typeof workflowRevisionLookupSchema>;
export type AddWorkflowCommentInput = z.infer<typeof addWorkflowCommentSchema>;
export type WorkflowResourceSearchInput = z.infer<typeof workflowResourceSearchSchema>;
export type WorkflowCommentPageInput = z.infer<typeof workflowCommentPageSchema>;
