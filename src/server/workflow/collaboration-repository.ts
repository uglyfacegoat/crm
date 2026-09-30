import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { canEditWorkflowContext } from "./context-access";
import type { WorkflowDraft } from "./schemas";

const uuid = z.string().uuid();
const recipientRow = z.object({
  id: uuid,
  role: z.enum(["admin", "dispatcher", "manager", "accountant", "master"]),
  permission_overrides: z.record(z.string(), z.boolean()),
  watching: z.boolean(),
});
const activityRow = z.object({
  id: uuid,
  action: z.string(),
  actor_name: z.string().nullable(),
  created_at: z.coerce.date(),
});
const activityLabels: Record<string, string> = {
  "workflow.map.create": "создал карту",
  "workflow.map.save": "сохранил черновик",
  "workflow.map.archive": "архивировал карту",
  "workflow.comment.add": "добавил комментарий",
  "workflow.review.request": "отправил на согласование",
  "workflow.review.approve": "согласовал версию",
  "workflow.review.reject": "вернул на доработку",
  "workflow.revision.publish": "опубликовал версию",
  "workflow.revision.restore": "восстановил версию",
  "workflow.watch.start": "начал следить за картой",
  "workflow.watch.stop": "перестал следить за картой",
};
export type WorkflowActivity = { id: string; label: string; actorName: string; createdAt: string };
export class WorkflowCollaborationMapNotFoundError extends Error {
  constructor() { super("Workflow map is unavailable."); this.name = "WorkflowCollaborationMapNotFoundError"; }
}

export async function watchWorkflowMap(member: AuthenticatedMember, mapId: string, watching: boolean) {
  requirePermission(member, "workflow.read");
  requirePermission(member, "notifications.read");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [map] = await transaction`SELECT id FROM workflow_maps WHERE organization_id = ${member.organizationId}
      AND id = ${mapId} AND archived_at IS NULL`;
    if (!map) throw new WorkflowCollaborationMapNotFoundError();
    const changed = watching
      ? await transaction`INSERT INTO workflow_map_watchers (organization_id, map_id, member_id)
          VALUES (${member.organizationId}, ${mapId}, ${member.memberId})
          ON CONFLICT DO NOTHING RETURNING member_id`
      : await transaction`DELETE FROM workflow_map_watchers WHERE organization_id = ${member.organizationId}
          AND map_id = ${mapId} AND member_id = ${member.memberId} RETURNING member_id`;
    if (changed.length) await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        ${watching ? "workflow.watch.start" : "workflow.watch.stop"}, 'workflow_map', ${mapId},
        ${transaction.json({ watching })})`;
    return watching;
  });
}

export async function getWorkflowCollaboration(member: AuthenticatedMember, mapId: string) {
  requirePermission(member, "workflow.read");
  const sql = getDatabase();
  const [map] = await sql`SELECT id FROM workflow_maps WHERE organization_id = ${member.organizationId}
    AND id = ${mapId} AND archived_at IS NULL`;
  if (!map) throw new WorkflowCollaborationMapNotFoundError();
  const [watchRows, activityRows] = await Promise.all([
    sql`SELECT member_id FROM workflow_map_watchers WHERE organization_id = ${member.organizationId}
      AND map_id = ${mapId} AND member_id = ${member.memberId}`,
    sql`SELECT event.id, event.action, actor.display_name AS actor_name, event.created_at
      FROM audit_events event LEFT JOIN organization_members actor
        ON actor.organization_id = event.organization_id AND actor.id = event.actor_id
      WHERE event.organization_id = ${member.organizationId} AND event.entity_type = 'workflow_map'
        AND event.entity_id = ${mapId} AND event.action LIKE 'workflow.%'
      ORDER BY event.created_at DESC, event.id DESC LIMIT 30`,
  ]);
  return { watching: watchRows.length > 0,
    activity: z.array(activityRow).parse(activityRows).map((row): WorkflowActivity => ({
      id: row.id, label: activityLabels[row.action] ?? "изменил карту",
      actorName: row.actor_name ?? "Система", createdAt: row.created_at.toISOString(),
    })) };
}

export async function followWorkflowParticipant(transaction: postgres.TransactionSql,
  organizationId: string, mapId: string, memberId: string) {
  await transaction`INSERT INTO workflow_map_watchers (organization_id, map_id, member_id)
    VALUES (${organizationId}, ${mapId}, ${memberId}) ON CONFLICT DO NOTHING`;
}

export async function notifyWorkflowChange(transaction: postgres.TransactionSql, input: {
  organizationId: string;
  mapId: string;
  actorId: string;
  title: string;
  body: string;
  audience: "watchers" | "reviewers";
  draft?: WorkflowDraft;
  additionalMemberIds?: string[];
}) {
  const rows = await transaction`SELECT member.id, member.role,
      coalesce(overrides.values, '{}'::jsonb) AS permission_overrides,
      watcher.member_id IS NOT NULL AS watching
    FROM organization_members member
    LEFT JOIN workflow_map_watchers watcher ON watcher.organization_id = member.organization_id
      AND watcher.map_id = ${input.mapId} AND watcher.member_id = member.id
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(permission, allowed) AS values FROM member_permission_overrides
      WHERE organization_id = member.organization_id AND member_id = member.id
    ) overrides ON true
    WHERE member.organization_id = ${input.organizationId} AND member.active
      AND member.id <> ${input.actorId}`;
  const extras = new Set(input.additionalMemberIds ?? []);
  const recipients = z.array(recipientRow).parse(rows).filter((row) => {
    const subject = { role: row.role, permissionOverrides: row.permission_overrides };
    return hasPermission(subject, "workflow.read") && hasPermission(subject, "notifications.read")
      && (input.audience === "reviewers"
        ? hasPermission(subject, "workflow.review") && (!input.draft || canEditWorkflowContext(subject, input.draft))
        : row.watching || extras.has(row.id));
  });
  if (!recipients.length) return 0;
  const eventKey = `workflow:${randomUUID()}`;
  const inserts = recipients.map((row) => ({
    organization_id: input.organizationId, recipient_member_id: row.id,
    kind: "workflow_update", severity: "info", title: input.title, body: input.body,
    source_type: "workflow", source_id: input.mapId,
    target_type: "workflow", target_id: input.mapId, event_key: eventKey,
    occurred_at: new Date(),
  }));
  await transaction`INSERT INTO notifications ${transaction(inserts,
    "organization_id", "recipient_member_id", "kind", "severity", "title", "body", "source_type",
    "source_id", "target_type", "target_id", "event_key", "occurred_at")}
    ON CONFLICT (organization_id, recipient_member_id, event_key) DO NOTHING`;
  return recipients.length;
}
