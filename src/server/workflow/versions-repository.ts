import "server-only";
import type postgres from "postgres";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { AuthorizationError } from "@/server/auth/permissions";
import { canEditWorkflowContext, validateWorkflowContext, visibleWorkflowDraft } from "./context-access";
import { notifyWorkflowChange } from "./collaboration-repository";
import { WorkflowMapConflictError, WorkflowMapNotFoundError } from "./repository";
import {
  workflowDraftSchema,
  type RejectWorkflowReviewInput,
  type RestoreWorkflowRevisionInput,
  type WorkflowRevisionLookupInput,
  type WorkflowVersionCommandInput,
} from "./schemas";

const uuid = z.string().uuid();
const stateRowSchema = z.object({
  title: z.string(),
  version: z.number().int().positive(),
  draft: workflowDraftSchema,
  review_version: z.number().int().positive().nullable(),
  review_requested_by: uuid.nullable(),
  approved_version: z.number().int().positive().nullable(),
  approved_by: uuid.nullable(),
  published_version: z.number().int().positive().nullable(),
});
const revisionRowSchema = z.object({
  version: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  draft: workflowDraftSchema,
  change_kind: z.enum(["created", "saved", "restored", "archived", "baseline"]),
  source_version: z.number().int().positive().nullable(),
  saved_at: z.coerce.date(),
  saved_by_name: z.string(),
});

export type WorkflowRevision = {
  version: number;
  title: string;
  description: string;
  draft: z.infer<typeof workflowDraftSchema>;
  changeKind: z.infer<typeof revisionRowSchema>["change_kind"];
  sourceVersion: number | null;
  savedAt: string;
  savedByName: string;
};

export class WorkflowReviewStateError extends Error {
  constructor(public readonly reason: "empty" | "not_requested" | "self_review" | "not_approved" | "already_approved" | "already_published") {
    super(`Workflow review transition rejected: ${reason}.`);
    this.name = "WorkflowReviewStateError";
  }
}

async function lockedMap(transaction: postgres.TransactionSql, organizationId: string, id: string) {
  const [row] = await transaction`SELECT title, version, draft, review_version, review_requested_by,
      approved_version, approved_by, published_version FROM workflow_maps
    WHERE organization_id = ${organizationId} AND id = ${id} AND archived_at IS NULL FOR UPDATE`;
  if (!row) throw new WorkflowMapNotFoundError();
  return stateRowSchema.parse(row);
}

export async function getWorkflowRevision(member: AuthenticatedMember, input: WorkflowRevisionLookupInput): Promise<WorkflowRevision> {
  requirePermission(member, "workflow.read");
  const sql = getDatabase();
  const [row] = await sql`SELECT revision.version, revision.title, revision.description,
      revision.draft, revision.change_kind, revision.source_version, revision.saved_at,
      author.display_name AS saved_by_name
    FROM workflow_map_revisions revision
    JOIN workflow_maps map ON map.organization_id = revision.organization_id
      AND map.id = revision.map_id AND map.archived_at IS NULL
    JOIN organization_members author ON author.organization_id = revision.organization_id
      AND author.id = revision.saved_by
    WHERE revision.organization_id = ${member.organizationId}
      AND revision.map_id = ${input.id} AND revision.version = ${input.version}`;
  if (!row) throw new WorkflowMapNotFoundError();
  const revision = revisionRowSchema.parse(row);
  return { version: revision.version, title: revision.title, description: revision.description,
    draft: visibleWorkflowDraft(member, revision.draft), changeKind: revision.change_kind, sourceVersion: revision.source_version,
    savedAt: revision.saved_at.toISOString(), savedByName: revision.saved_by_name };
}

export async function requestWorkflowReview(member: AuthenticatedMember, input: WorkflowVersionCommandInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const map = await lockedMap(transaction, member.organizationId, input.id);
    if (map.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, map.draft)) throw new AuthorizationError();
    if (map.draft.nodes.length === 0) throw new WorkflowReviewStateError("empty");
    if (map.published_version === map.version) throw new WorkflowReviewStateError("already_published");
    if (map.approved_version === map.version) throw new WorkflowReviewStateError("already_approved");
    if (map.review_version === map.version) return;
    await transaction`UPDATE workflow_maps SET review_version = ${map.version},
      review_requested_by = ${member.memberId}, review_requested_at = now(),
      approved_version = NULL, approved_by = NULL, approved_at = NULL
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.review.request', 'workflow_map', ${input.id},
        ${transaction.json({ version: map.version })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "reviewers", draft: map.draft,
      title: "Карта ждёт согласования",
      body: `${member.displayName} отправил версию ${map.version} карты «${map.title}» на согласование.` });
  });
}

export async function approveWorkflowReview(member: AuthenticatedMember, input: WorkflowVersionCommandInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.review");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const map = await lockedMap(transaction, member.organizationId, input.id);
    if (map.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, map.draft)) throw new AuthorizationError();
    if (map.review_version !== map.version) throw new WorkflowReviewStateError("not_requested");
    if (map.review_requested_by === member.memberId) throw new WorkflowReviewStateError("self_review");
    if (map.approved_version === map.version) return;
    await transaction`UPDATE workflow_maps SET approved_version = ${map.version},
      approved_by = ${member.memberId}, approved_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.review.approve', 'workflow_map', ${input.id},
        ${transaction.json({ version: map.version })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "watchers", additionalMemberIds: [map.review_requested_by!],
      title: "Версия карты согласована",
      body: `${member.displayName} согласовал версию ${map.version} карты «${map.title}».` });
  });
}

export async function rejectWorkflowReview(member: AuthenticatedMember, input: RejectWorkflowReviewInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.review");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const map = await lockedMap(transaction, member.organizationId, input.id);
    if (map.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, map.draft)) throw new AuthorizationError();
    if (map.review_version !== map.version || map.approved_version === map.version) throw new WorkflowReviewStateError("not_requested");
    if (map.review_requested_by === member.memberId) throw new WorkflowReviewStateError("self_review");
    await transaction`UPDATE workflow_maps SET review_version = NULL,
      review_requested_by = NULL, review_requested_at = NULL,
      approved_version = NULL, approved_by = NULL, approved_at = NULL
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.review.reject', 'workflow_map', ${input.id},
        ${transaction.json({ version: map.version, reason: input.reason })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "watchers", additionalMemberIds: [map.review_requested_by!],
      title: "Версия карты возвращена",
      body: `${member.displayName} вернул версию ${map.version} карты «${map.title}» на доработку: ${input.reason}` });
  });
}

export async function publishWorkflowRevision(member: AuthenticatedMember, input: WorkflowVersionCommandInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.publish");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const map = await lockedMap(transaction, member.organizationId, input.id);
    if (map.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, map.draft)) throw new AuthorizationError();
    if (map.approved_version !== map.version) throw new WorkflowReviewStateError("not_approved");
    if (map.published_version === map.version) return;
    await transaction`UPDATE workflow_maps SET published_version = ${map.version},
      published_by = ${member.memberId}, published_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.revision.publish', 'workflow_map', ${input.id},
        ${transaction.json({ version: map.version })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "watchers",
      additionalMemberIds: [map.review_requested_by, map.approved_by].filter((id): id is string => id !== null),
      title: "Версия карты опубликована",
      body: `${member.displayName} опубликовал версию ${map.version} карты «${map.title}».` });
  });
}

export async function restoreWorkflowRevision(member: AuthenticatedMember, input: RestoreWorkflowRevisionInput) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "workflow.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const map = await lockedMap(transaction, member.organizationId, input.id);
    if (map.version !== input.expectedVersion) throw new WorkflowMapConflictError();
    if (!canEditWorkflowContext(member, map.draft)) throw new AuthorizationError();
    const [source] = await transaction`SELECT title, description, draft FROM workflow_map_revisions
      WHERE organization_id = ${member.organizationId} AND map_id = ${input.id}
        AND version = ${input.sourceVersion}`;
    if (!source) throw new WorkflowMapNotFoundError();
    const sourceDraft = workflowDraftSchema.parse(source.draft);
    await validateWorkflowContext(transaction, member, sourceDraft);
    const nextVersion = map.version + 1;
    await transaction`UPDATE workflow_maps SET title = ${source.title},
      description = ${source.description}, draft = ${transaction.json(sourceDraft)},
      version = ${nextVersion}, updated_by = ${member.memberId}, updated_at = now(),
      review_version = NULL, review_requested_by = NULL, review_requested_at = NULL,
      approved_version = NULL, approved_by = NULL, approved_at = NULL
      WHERE organization_id = ${member.organizationId} AND id = ${input.id}`;
    await transaction`INSERT INTO workflow_map_revisions
      (organization_id, map_id, version, title, description, draft,
       change_kind, source_version, saved_by)
      VALUES (${member.organizationId}, ${input.id}, ${nextVersion}, ${source.title},
        ${source.description}, ${transaction.json(sourceDraft)},
        'restored', ${input.sourceVersion}, ${member.memberId})`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'workflow.revision.restore', 'workflow_map', ${input.id},
        ${transaction.json({ fromVersion: input.sourceVersion, version: nextVersion })})`;
    await notifyWorkflowChange(transaction, { organizationId: member.organizationId, mapId: input.id,
      actorId: member.memberId, audience: "watchers", title: "Карта процесса изменена",
      body: `${member.displayName} восстановил версию ${input.sourceVersion} карты «${source.title}» в новый черновик.` });
    return nextVersion;
  });
}
