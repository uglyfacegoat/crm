import { z } from "zod";
import { visitStatuses, type VisitStatus } from "./types.ts";

export const visitEventTypes = ["created", "schedule_changed", "status_changed", "master_changed", "notes_changed"] as const;
export type VisitEventType = (typeof visitEventTypes)[number];

export type VisitHistoryState = {
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  status: VisitStatus | null;
  assignedMasterId: string | null;
  cancellationReason: string | null;
  notes: string | null;
};

export type VisitHistoryEvent = {
  id: string;
  visitId: string;
  eventType: VisitEventType;
  actorName: string;
  reason: string | null;
  occurredAt: string;
  beforeState: VisitHistoryState | null;
  afterState: VisitHistoryState;
};

export type VisitHistoryFeed = {
  events: VisitHistoryEvent[];
  totalCount: number;
  hasMore: boolean;
};

const eventStateSchema = z.object({
  scheduledStartAt: z.string().optional().nullable(),
  scheduledEndAt: z.string().optional().nullable(),
  status: z.enum(visitStatuses).optional().nullable(),
  assignedMasterId: z.string().uuid().optional().nullable(),
  cancellationReason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const eventRowSchema = z.object({
  id: z.string().uuid(),
  visit_id: z.string().uuid(),
  event_type: z.enum(visitEventTypes),
  actor_name: z.string().min(1),
  reason: z.string().nullable(),
  before_state: z.record(z.string(), z.unknown()).nullable(),
  after_state: z.record(z.string(), z.unknown()),
  created_at: z.coerce.date(),
  total_count: z.number().int().nonnegative(),
});

function normalizedTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function mapState(value: Record<string, unknown>): VisitHistoryState {
  const state = eventStateSchema.parse(value);
  return {
    scheduledStartAt: normalizedTimestamp(state.scheduledStartAt),
    scheduledEndAt: normalizedTimestamp(state.scheduledEndAt),
    status: state.status ?? null,
    assignedMasterId: state.assignedMasterId ?? null,
    cancellationReason: state.cancellationReason ?? null,
    notes: state.notes ?? null,
  };
}

export function mapVisitHistoryEvent(value: unknown): VisitHistoryEvent & { totalCount: number } {
  const row = eventRowSchema.parse(value);
  return {
    id: row.id,
    visitId: row.visit_id,
    eventType: row.event_type,
    actorName: row.actor_name,
    reason: row.reason,
    occurredAt: row.created_at.toISOString(),
    beforeState: row.before_state ? mapState(row.before_state) : null,
    afterState: mapState(row.after_state),
    totalCount: row.total_count,
  };
}

export function buildVisitHistoryFeed(rows: readonly unknown[], limit: number): VisitHistoryFeed {
  const mappedRows = rows.map(mapVisitHistoryEvent);
  const totalCount = mappedRows[0]?.totalCount ?? 0;
  return {
    events: mappedRows.map((row) => ({
      id: row.id,
      visitId: row.visitId,
      eventType: row.eventType,
      actorName: row.actorName,
      reason: row.reason,
      occurredAt: row.occurredAt,
      beforeState: row.beforeState,
      afterState: row.afterState,
    })),
    totalCount,
    hasMore: totalCount > limit,
  };
}

export const emptyVisitHistoryFeed: VisitHistoryFeed = { events: [], totalCount: 0, hasMore: false };
