import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
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
});
const listRowSchema = mapRowSchema.omit({ draft: true, description: true });

export type WorkflowMap = {
  id: string;
  title: string;
  description: string;
  draft: WorkflowDraft;
  version: number;
  updatedAt: string;
  updatedByName: string;
};
export type WorkflowMapSummary = Omit<WorkflowMap, "description" | "draft">;

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
  if (!selectedId) return { maps, selected: null };
  const [selectedRow] = await sql`SELECT map.id, map.title, map.description, map.draft,
      map.version, map.updated_at, author.display_name AS updated_by_name
    FROM workflow_maps map
    JOIN organization_members author ON author.organization_id = map.organization_id AND author.id = map.updated_by
    WHERE map.organization_id = ${member.organizationId} AND map.id = ${selectedId}
      AND map.archived_at IS NULL`;
  if (!selectedRow) return { maps, selected: null };
  const selected = mapRowSchema.parse(selectedRow);
  return { maps, selected: { ...toSummary(selected), description: selected.description,
    draft: selected.draft } satisfies WorkflowMap };
}

export async function createWorkflowMap(member: AuthenticatedMember, input: CreateWorkflowMapInput) {
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
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.create', 'workflow_map', ${input.id}, ${transaction.json({ title: input.title })})`;
    return input.id;
  });
}

export async function saveWorkflowMap(member: AuthenticatedMember, input: SaveWorkflowMapInput) {
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [updated] = await transaction`UPDATE workflow_maps SET
      title = ${input.title}, description = ${input.description}, draft = ${transaction.json(input.draft)},
      version = version + 1, updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}
        AND version = ${input.expectedVersion} AND archived_at IS NULL
      RETURNING version`;
    if (!updated) {
      const [existing] = await transaction`SELECT version FROM workflow_maps
        WHERE organization_id = ${member.organizationId} AND id = ${input.id} AND archived_at IS NULL`;
      if (!existing) throw new WorkflowMapNotFoundError();
      throw new WorkflowMapConflictError();
    }
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.save', 'workflow_map', ${input.id},
        ${transaction.json({ version: updated.version, title: input.title,
          nodeCount: input.draft.nodes.length, edgeCount: input.draft.edges.length })})`;
    return z.number().int().positive().parse(updated.version);
  });
}

export async function archiveWorkflowMap(member: AuthenticatedMember, input: ArchiveWorkflowMapInput) {
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [archived] = await transaction`UPDATE workflow_maps SET archived_at = now(),
      updated_at = now(), updated_by = ${member.memberId}, version = version + 1
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}
        AND version = ${input.expectedVersion} AND archived_at IS NULL
      RETURNING version`;
    if (!archived) {
      const [existing] = await transaction`SELECT version FROM workflow_maps
        WHERE organization_id = ${member.organizationId} AND id = ${input.id} AND archived_at IS NULL`;
      if (!existing) throw new WorkflowMapNotFoundError();
      throw new WorkflowMapConflictError();
    }
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.map.archive', 'workflow_map', ${input.id},
        ${transaction.json({ version: archived.version })})`;
  });
}
