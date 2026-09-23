import "server-only";
import { z } from "zod";
import { notificationHref, notificationKinds, notificationSeverities, notificationSourceTypes, notificationTargetTypes, type NotificationCursor, type NotificationSnapshot } from "@/lib/notifications";
import type { AuthenticatedMember } from "@/server/auth/types";
import { requirePermission } from "@/server/auth/permissions";
import { getDatabase } from "@/server/database";

const uuidSchema = z.string().uuid();
const notificationRowSchema = z.object({
  id: uuidSchema,
  kind: z.enum(notificationKinds),
  severity: z.enum(notificationSeverities),
  title: z.string(),
  body: z.string(),
  source_type: z.enum(notificationSourceTypes),
  source_id: uuidSchema,
  target_type: z.enum(notificationTargetTypes),
  target_id: uuidSchema,
  occurred_at: z.coerce.date(),
  read_at: z.coerce.date().nullable(),
});

const summaryRowSchema = z.object({
  unread_count: z.number().int().nonnegative(),
  critical_unread_count: z.number().int().nonnegative(),
});

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notification was not found.");
    this.name = "NotificationNotFoundError";
  }
}

export async function listNotifications(
  member: AuthenticatedMember,
  options: { limit: number; unreadOnly: boolean; cursor?: NotificationCursor | null },
): Promise<NotificationSnapshot> {
  requirePermission(member, "notifications.read");
  const sql = getDatabase();
  const cursorAt = options.cursor?.occurredAt ?? null;
  const cursorId = options.cursor?.id ?? null;
  const [rows, summaryRows] = await Promise.all([
    sql`SELECT id, kind, severity, title, body, source_type, source_id, target_type, target_id, occurred_at, read_at
      FROM notifications
      WHERE organization_id = ${member.organizationId}
        AND recipient_member_id = ${member.memberId}
        AND resolved_at IS NULL
        AND (${options.unreadOnly} = false OR read_at IS NULL)
        AND (${cursorAt}::timestamptz IS NULL OR (occurred_at, id) < (${cursorAt}::timestamptz, ${cursorId}::uuid))
      ORDER BY occurred_at DESC, id DESC
      LIMIT ${options.limit + 1}`,
    sql`SELECT
        count(*) FILTER (WHERE read_at IS NULL)::integer AS unread_count,
        count(*) FILTER (WHERE read_at IS NULL AND severity = 'critical')::integer AS critical_unread_count
      FROM notifications
      WHERE organization_id = ${member.organizationId}
        AND recipient_member_id = ${member.memberId}
        AND resolved_at IS NULL`,
  ]);
  const summary = summaryRowSchema.parse(summaryRows[0]);
  const visibleRows = rows.slice(0, options.limit);
  const lastRow = visibleRows.at(-1);
  return {
    items: visibleRows.map((value) => {
      const row = notificationRowSchema.parse(value);
      return {
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        title: row.title,
        body: row.body,
        sourceType: row.source_type,
        sourceId: row.source_id,
        targetType: row.target_type,
        targetId: row.target_id,
        href: notificationHref(row.target_type, row.target_id, member.role),
        occurredAt: row.occurred_at.toISOString(),
        readAt: row.read_at?.toISOString() ?? null,
      };
    }),
    unreadCount: summary.unread_count,
    criticalUnreadCount: summary.critical_unread_count,
    nextCursor: rows.length > options.limit && lastRow
      ? { occurredAt: notificationRowSchema.parse(lastRow).occurred_at.toISOString(), id: notificationRowSchema.parse(lastRow).id }
      : null,
    generatedAt: new Date().toISOString(),
  };
}

export async function markNotificationRead(member: AuthenticatedMember, notificationId: string) {
  requirePermission(member, "notifications.read");
  const sql = getDatabase();
  const rows = await sql`UPDATE notifications
    SET read_at = coalesce(read_at, now()), updated_at = CASE WHEN read_at IS NULL THEN now() ELSE updated_at END
    WHERE organization_id = ${member.organizationId}
      AND recipient_member_id = ${member.memberId}
      AND id = ${notificationId}
      AND resolved_at IS NULL
    RETURNING id`;
  if (!rows.length) throw new NotificationNotFoundError();
  return 1;
}

export async function markAllNotificationsRead(member: AuthenticatedMember) {
  requirePermission(member, "notifications.read");
  const sql = getDatabase();
  const rows = await sql`UPDATE notifications
    SET read_at = now(), updated_at = now()
    WHERE organization_id = ${member.organizationId}
      AND recipient_member_id = ${member.memberId}
      AND resolved_at IS NULL
      AND read_at IS NULL
    RETURNING id`;
  return rows.length;
}
