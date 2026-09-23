import { z } from "zod";
import type { OrganizationRole } from "@/server/auth/types";

export const notificationKinds = [
  "visit_upcoming",
  "visit_unassigned",
  "closing_act_overdue",
  "task_overdue",
  "contract_renewal",
  "document_uploaded",
] as const;

export const notificationSeverities = ["info", "warning", "critical"] as const;
export const notificationTargetTypes = ["order", "visit", "task", "client", "document"] as const;
export const notificationSourceTypes = ["visit", "task", "contract", "document"] as const;

export const notificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(notificationKinds),
  severity: z.enum(notificationSeverities),
  title: z.string(),
  body: z.string(),
  sourceType: z.enum(notificationSourceTypes),
  sourceId: z.string().uuid(),
  targetType: z.enum(notificationTargetTypes),
  targetId: z.string().uuid(),
  href: z.string().startsWith("/"),
  occurredAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

export const notificationSnapshotSchema = z.object({
  items: z.array(notificationItemSchema),
  unreadCount: z.number().int().nonnegative(),
  criticalUnreadCount: z.number().int().nonnegative(),
  nextCursor: z.object({ occurredAt: z.iso.datetime({ offset: true }), id: z.string().uuid() }).nullable(),
  generatedAt: z.string().datetime(),
});

export const notificationResponseSchema = z.object({ data: notificationSnapshotSchema });
export const notificationMutationResponseSchema = z.object({
  data: z.object({ updated: z.number().int().nonnegative() }),
});

export const notificationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(12),
  unread: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  beforeAt: z.iso.datetime({ offset: true }).optional(),
  beforeId: z.string().uuid().optional(),
}).refine((value) => Boolean(value.beforeAt) === Boolean(value.beforeId), { message: "Обе части курсора обязательны." });

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type NotificationSnapshot = z.infer<typeof notificationSnapshotSchema>;
export type NotificationCursor = NonNullable<NotificationSnapshot["nextCursor"]>;
export type NotificationSeverity = (typeof notificationSeverities)[number];
export type NotificationTargetType = (typeof notificationTargetTypes)[number];

export function notificationHref(targetType: NotificationTargetType, targetId: string, role: OrganizationRole) {
  if (role === "master") return "/my-visits";
  switch (targetType) {
    case "order": return `/orders/${targetId}`;
    case "visit": return "/calendar";
    case "task": return "/tasks";
    case "client": return `/clients/${targetId}`;
    case "document": return `/documents?document=${encodeURIComponent(targetId)}`;
  }
}
