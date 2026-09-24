import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { WorkflowMapConflictError, WorkflowMapNotFoundError } from "./repository";
import { canReadWorkflowResource } from "./context-access";
import { notifyWorkflowChange } from "./collaboration-repository";
import type { AddWorkflowCommentInput, WorkflowNode } from "./schemas";

const uuid = z.string().uuid();
const commentRow = z.object({ id: uuid, body: z.string(), author_name: z.string(), created_at: z.coerce.date() });
const memberRow = z.object({ id: uuid, display_name: z.string() });
const resourceRow = z.object({ id: uuid, label: z.string() });
export type WorkflowComment = { id: string; body: string; authorName: string; createdAt: string };
export type WorkflowMemberOption = { id: string; name: string };
export type WorkflowResourceOption = { id: string; label: string };
export type WorkflowCommentPage = { comments: WorkflowComment[]; hasMore: boolean };

export async function listWorkflowComments(member: AuthenticatedMember, mapId: string, beforeId: string | null = null): Promise<WorkflowCommentPage> {
  requirePermission(member, "workflow.read");
  const sql = getDatabase();
  const [map] = await sql`SELECT id FROM workflow_maps
    WHERE organization_id = ${member.organizationId} AND id = ${mapId} AND archived_at IS NULL`;
  if (!map) throw new WorkflowMapNotFoundError();
  const [cursor] = beforeId ? await sql`SELECT id FROM workflow_comments
    WHERE organization_id = ${member.organizationId} AND map_id = ${mapId} AND id = ${beforeId}` : [];
  if (beforeId && !cursor) throw new WorkflowMapNotFoundError();
  const rows = cursor
    ? await sql`SELECT comment.id, comment.body, author.display_name AS author_name, comment.created_at
        FROM workflow_comments comment JOIN organization_members author
          ON author.organization_id = comment.organization_id AND author.id = comment.author_id
        WHERE comment.organization_id = ${member.organizationId} AND comment.map_id = ${mapId}
          AND (comment.created_at, comment.id) < (
            SELECT marker.created_at, marker.id FROM workflow_comments marker
            WHERE marker.organization_id = ${member.organizationId} AND marker.map_id = ${mapId}
              AND marker.id = ${beforeId})
        ORDER BY comment.created_at DESC, comment.id DESC LIMIT 51`
    : await sql`SELECT comment.id, comment.body, author.display_name AS author_name, comment.created_at
        FROM workflow_comments comment JOIN organization_members author
          ON author.organization_id = comment.organization_id AND author.id = comment.author_id
        WHERE comment.organization_id = ${member.organizationId} AND comment.map_id = ${mapId}
        ORDER BY comment.created_at DESC, comment.id DESC LIMIT 51`;
  const parsed = z.array(commentRow).parse(rows);
  return { comments: parsed.slice(0, 50).map((row): WorkflowComment => ({ id: row.id,
    body: row.body, authorName: row.author_name, createdAt: row.created_at.toISOString() })), hasMore: parsed.length > 50 };
}

export async function getWorkflowContext(member: AuthenticatedMember, mapId: string) {
  requirePermission(member, "workflow.read");
  const sql = getDatabase();
  const [map] = await sql`SELECT id FROM workflow_maps
    WHERE organization_id = ${member.organizationId} AND id = ${mapId} AND archived_at IS NULL`;
  if (!map) throw new WorkflowMapNotFoundError();
  const [commentPage, memberRows] = await Promise.all([
    listWorkflowComments(member, mapId),
    sql`SELECT id, display_name FROM organization_members
      WHERE organization_id = ${member.organizationId} AND active ORDER BY display_name, id LIMIT 500`,
  ]);
  return {
    ...commentPage,
    members: z.array(memberRow).parse(memberRows).map((row): WorkflowMemberOption => ({ id: row.id, name: row.display_name })),
  };
}

export async function addWorkflowComment(member: AuthenticatedMember, input: AddWorkflowCommentInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.comment");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [map] = await transaction`SELECT id, title FROM workflow_maps
      WHERE organization_id = ${member.organizationId} AND id = ${input.mapId} AND archived_at IS NULL`;
    if (!map) throw new WorkflowMapNotFoundError();
    const [created] = await transaction`INSERT INTO workflow_comments
      (organization_id, map_id, id, body, author_id)
      VALUES (${member.organizationId}, ${input.mapId}, ${input.id}, ${input.body}, ${member.memberId})
      ON CONFLICT (organization_id, id) DO NOTHING RETURNING id`;
    if (!created) {
      const [existing] = await transaction`SELECT id FROM workflow_comments
        WHERE organization_id = ${member.organizationId} AND map_id = ${input.mapId}
          AND id = ${input.id} AND body = ${input.body} AND author_id = ${member.memberId}`;
      if (!existing) throw new WorkflowMapConflictError();
      return input.id;
    }
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.comment.add', 'workflow_map', ${input.mapId},
        ${transaction.json({ commentId: input.id })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.mapId,
      actorId: member.memberId, audience: "watchers", title: "Новое обсуждение карты",
      body: `${member.displayName} добавил комментарий к карте «${map.title}».` });
    return input.id;
  });
}

export async function findWorkflowResources(member: AuthenticatedMember, mapId: string,
  kind: NonNullable<WorkflowNode["resource"]>["kind"], query: string): Promise<WorkflowResourceOption[]> {
  requirePermission(member, "workflow.read");
  if (!canReadWorkflowResource(member, { kind, id: mapId })) return [];
  const sql = getDatabase();
  const [map] = await sql`SELECT id FROM workflow_maps
    WHERE organization_id = ${member.organizationId} AND id = ${mapId} AND archived_at IS NULL`;
  if (!map) throw new WorkflowMapNotFoundError();
  const pattern = `%${query.trim().slice(0, 100).replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const rows = kind === "client"
    ? await sql`SELECT id, legal_name AS label FROM clients
        WHERE organization_id = ${member.organizationId} AND legal_name ILIKE ${pattern}
        ORDER BY legal_name, id LIMIT 20`
    : kind === "order"
      ? await sql`SELECT id, order_number AS label FROM orders
          WHERE organization_id = ${member.organizationId} AND order_number ILIKE ${pattern}
          ORDER BY order_number, id LIMIT 20`
      : await sql`SELECT id, contract_number AS label FROM contracts
          WHERE organization_id = ${member.organizationId} AND contract_number ILIKE ${pattern}
          ORDER BY contract_number, id LIMIT 20`;
  return z.array(resourceRow).parse(rows);
}
