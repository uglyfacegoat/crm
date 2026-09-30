import "server-only";
import { z } from "zod";
import { AuthorizationError, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { canEditWorkflowContext, validateWorkflowContext, visibleWorkflowDraft } from "./context-access";
import { followWorkflowParticipant, notifyWorkflowChange } from "./collaboration-repository";
import {
  workflowDraftSchema,
  type ArchiveWorkflowMapInput,
  type CreateWorkflowMapInput,
  type SaveWorkflowMapInput,
  type WorkflowDraft,
} from "./schemas";

const uuid = z.string().uuid();
const mapRowSchema = z.object({
  id: uuid,
  title: z.string(),
  description: z.string(),
  draft: workflowDraftSchema,
  version: z.number().int().positive(),
  updated_at: z.coerce.date(),
  updated_by_name: z.string(),
  review_version: z.number().int().positive().nullable(),
  review_requested_by: uuid.nullable(),
  approved_version: z.number().int().positive().nullable(),
  published_version: z.number().int().positive().nullable(),
  published_at: z.coerce.date().nullable(),
});
const listRowSchema = mapRowSchema.pick({ id: true, title: true, version: true,
  updated_at: true, updated_by_name: true });
const revisionRowSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  change_kind: z.enum(["created", "saved", "restored", "archived", "baseline"]),
  source_version: z.number().int().positive().nullable(),
  saved_at: z.coerce.date(),
  saved_by_name: z.string(),
});

export type WorkflowMap = {
  id: string;
  title: string;
  description: string;
  draft: WorkflowDraft;
  version: number;
  updatedAt: string;
  updatedByName: string;
  reviewVersion: number | null;
  reviewRequestedBy: string | null;
  approvedVersion: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  contextEditable: boolean;
};
export type WorkflowMapSummary = Pick<WorkflowMap, "id" | "title" | "version" | "updatedAt" | "updatedByName">;
export type WorkflowRevisionSummary = {
  version: number;
  title: string;
  changeKind: z.infer<typeof revisionRowSchema>["change_kind"];
  sourceVersion: number | null;
  savedAt: string;
  savedByName: string;
};

export class WorkflowMapNotFoundError extends Error {
  constructor() { super("Workflow map not found."); this.name = "WorkflowMapNotFoundError"; }
}
export class WorkflowMapConflictError extends Error {
  constructor() { super("Workflow map changed in another session."); this.name = "WorkflowMapConflictError"; }
}

function toSummary(row: z.infer<typeof listRowSchema>): WorkflowMapSummary {
  return { id: row.id, title: row.title, version: row.version,
    updatedAt: row.updated_at.toISOString(), updatedByName: row.updated_by_name };
}

export async function getWorkflowWorkspace(member: AuthenticatedMember, requestedId: string | null) {
  requirePermission(member, "workflow.read");
  const sql = getDatabase();
  const rows = await sql`SELECT map.id, map.title, map.version, map.updated_at,
      author.display_name AS updated_by_name
    FROM workflow_maps map
    JOIN organization_members author ON author.organization_id = map.organization_id AND author.id = map.updated_by
    WHERE map.organization_id = ${member.organizationId} AND map.archived_at IS NULL
    ORDER BY map.updated_at DESC, map.id DESC LIMIT 100`;
  const maps = z.array(listRowSchema).parse(rows).map(toSummary);
  const selectedId = requestedId === null ? maps[0]?.id : uuid.safeParse(requestedId).success ? requestedId : null;
  if (!selectedId) return { maps, selected: null, revisions: [] as WorkflowRevisionSummary[] };
  const [selectedRow] = await sql`SELECT map.id, map.title, map.description, map.draft,
      map.version, map.updated_at, author.display_name AS updated_by_name,
      map.review_version, map.review_requested_by, map.approved_version,
      map.published_version, map.published_at
    FROM workflow_maps map
    JOIN organization_members author ON author.organization_id = map.organization_id AND author.id = map.updated_by
    WHERE map.organization_id = ${member.organizationId} AND map.id = ${selectedId}
      AND map.archived_at IS NULL`;
  if (!selectedRow) return { maps, selected: null, revisions: [] as WorkflowRevisionSummary[] };
  const selected = mapRowSchema.parse(selectedRow);
  const revisionRows = await sql`SELECT revision.version, revision.title, revision.change_kind,
      revision.source_version, revision.saved_at, author.display_name AS saved_by_name
    FROM workflow_map_revisions revision
    JOIN organization_members author ON author.organization_id = revision.organization_id AND author.id = revision.saved_by
    WHERE revision.organization_id = ${member.organizationId} AND revision.map_id = ${selectedId}
    ORDER BY revision.version DESC LIMIT 50`;
  const revisions = z.array(revisionRowSchema).parse(revisionRows).map((row): WorkflowRevisionSummary => ({
    version: row.version, title: row.title, changeKind: row.change_kind,
    sourceVersion: row.source_version, savedAt: row.saved_at.toISOString(), savedByName: row.saved_by_name,
  }));
  return { maps, selected: { ...toSummary(selected), description: selected.description,
    draft: visibleWorkflowDraft(member, selected.draft), contextEditable: canEditWorkflowContext(member, selected.draft), reviewVersion: selected.review_version,
    reviewRequestedBy: selected.review_requested_by, approvedVersion: selected.approved_version,
    publishedVersion: selected.published_version,
    publishedAt: selected.published_at?.toISOString() ?? null } satisfies WorkflowMap, revisions };
}

export async function createWorkflowMap(member: AuthenticatedMember, input: CreateWorkflowMapInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [inserted] = await transaction`INSERT INTO workflow_maps
      (id, organization_id, title, created_by, updated_by)
      VALUES (${input.id}, ${member.organizationId}, ${input.title}, ${member.memberId}, ${member.memberId})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    if (!inserted) {
      const [existing] = await transaction`SELECT id FROM workflow_maps
        WHERE organization_id = ${member.organizationId} AND id = ${input.id}
          AND created_by = ${member.memberId} AND title = ${input.title} AND archived_at IS NULL`;
      if (!existing) throw new WorkflowMapConflictError();
      return input.id;
    }
    await transaction`INSERT INTO workflow_map_revisions
      (organization_id, map_id, version, title, description, draft, change_kind, saved_by)
      VALUES (${member.organizationId}, ${input.id}, 1, ${input.title}, '',
        ${transaction.json({ nodes: [], edges: [] })}, 'created', ${member.memberId})`;
    await followWorkflowParticipant(transaction, member.organizationId, input.id, member.memberId);
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.create', 'workflow_map', ${input.id}, ${transaction.json({ title: input.title })})`;
    return input.id;
  });
}

export async function saveWorkflowMap(member: AuthenticatedMember, input: SaveWorkflowMapInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [current] = await transaction`SELECT version, draft FROM workflow_maps
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}
        AND archived_at IS NULL FOR UPDATE`;
    if (!current) throw new WorkflowMapNotFoundError();
    if (current.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, workflowDraftSchema.parse(current.draft))) throw new AuthorizationError();
    await validateWorkflowContext(transaction, member, input.draft);
    const [updated] = await transaction`UPDATE workflow_maps SET
      title = ${input.title}, description = ${input.description}, draft = ${transaction.json(input.draft)},
      version = version + 1, updated_by = ${member.memberId}, updated_at = now(),
      review_version = NULL, review_requested_by = NULL, review_requested_at = NULL,
      approved_version = NULL, approved_by = NULL, approved_at = NULL
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}
        AND version = ${input.expectedVersion} AND archived_at IS NULL
      RETURNING version`;
    if (!updated) {
      const [existing] = await transaction`SELECT version FROM workflow_maps
        WHERE organization_id = ${member.organizationId} AND id = ${input.id} AND archived_at IS NULL`;
      if (!existing) throw new WorkflowMapNotFoundError();
      throw new WorkflowMapConflictError();
    }
    await transaction`INSERT INTO workflow_map_revisions
      (organization_id, map_id, version, title, description, draft, change_kind, saved_by)
      VALUES (${member.organizationId}, ${input.id}, ${updated.version}, ${input.title},
        ${input.description}, ${transaction.json(input.draft)}, 'saved', ${member.memberId})`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.save', 'workflow_map', ${input.id},
        ${transaction.json({ version: updated.version, title: input.title,
          nodeCount: input.draft.nodes.length, edgeCount: input.draft.edges.length })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "watchers", title: "Карта процесса изменена",
      body: `${member.displayName} сохранил версию ${updated.version} карты «${input.title}».` });
    return z.number().int().positive().parse(updated.version);
  });
}

export async function archiveWorkflowMap(member: AuthenticatedMember, input: ArchiveWorkflowMapInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [archived] = await transaction`UPDATE workflow_maps SET archived_at = now(),
      updated_at = now(), updated_by = ${member.memberId}, version = version + 1,
      review_version = NULL, review_requested_by = NULL, review_requested_at = NULL,
      approved_version = NULL, approved_by = NULL, approved_at = NULL
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}
        AND version = ${input.expectedVersion} AND archived_at IS NULL
      RETURNING version, title, description, draft`;
    if (!archived) {
      const [existing] = await transaction`SELECT version FROM workflow_maps
        WHERE organization_id = ${member.organizationId} AND id = ${input.id} AND archived_at IS NULL`;
      if (!existing) throw new WorkflowMapNotFoundError();
      throw new WorkflowMapConflictError();
    }
    await transaction`INSERT INTO workflow_map_revisions
      (organization_id, map_id, version, title, description, draft, change_kind, saved_by)
      VALUES (${member.organizationId}, ${input.id}, ${archived.version}, ${archived.title},
        ${archived.description}, ${transaction.json(archived.draft)}, 'archived', ${member.memberId})`;
    const [activation] = await transaction`UPDATE workflow_automation_activations
      SET enabled = false, stopped_by = ${member.memberId}, stopped_at = now()
      WHERE organization_id = ${member.organizationId} AND map_id = ${input.id} AND enabled
      RETURNING activation_id`;
    if (activation) await transaction`UPDATE workflow_automation_jobs SET status = 'stopped',
      lease_until = NULL, completed_at = now()
      WHERE organization_id = ${member.organizationId} AND map_id = ${input.id}
        AND activation_id = ${activation.activation_id} AND status IN ('pending', 'running')`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.archive', 'workflow_map', ${input.id},
        ${transaction.json({ version: archived.version })})`;
    await transaction`UPDATE notifications SET resolved_at = now(), updated_at = now()
      WHERE organization_id = ${member.organizationId} AND source_type = 'workflow'
        AND source_id = ${input.id} AND resolved_at IS NULL`;
  });
}
