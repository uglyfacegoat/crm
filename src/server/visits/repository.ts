import "server-only";
import { z } from "zod";
import { AuthorizationError, hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { generateVisitRecurrenceDates } from "@/lib/visits/recurrence";
import type { VisitDispatchCard } from "@/lib/visits/dispatch-card";
import { minorUnitsToSafeNumber } from "@/server/orders/money";
import type { CompleteVisitInput, CreateVisitInput, CreateVisitSeriesInput, RescheduleVisitInput, StartVisitInput, UpdateVisitInput } from "./schemas";
import { buildVisitHistoryFeed, type VisitHistoryFeed } from "./history";
import { visitStatusLabels, type ServiceVisit } from "./types";

const uuidSchema = z.string().uuid();
const timestampRangeSchema = z.object({ start_at: z.coerce.date(), end_at: z.coerce.date() });
const datedTimestampRangeSchema = timestampRangeSchema.extend({ local_date: z.string() });
const visitRowSchema = z.object({
  id: uuidSchema,
  series_id: uuidSchema.nullable(),
  occurrence_number: z.number().int().positive().nullable(),
  order_id: uuidSchema.nullable(),
  order_number: z.string().nullable(),
  client_name_snapshot: z.string(),
  object_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  scheduled_start_at: z.coerce.date(),
  scheduled_end_at: z.coerce.date(),
  timezone: z.string(),
  status: z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]),
  is_copyable: z.boolean().default(false),
  assigned_master_id: uuidSchema.nullable(),
  master_name_snapshot: z.string().nullable(),
  master_phone_snapshot: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  notes: z.string().nullable(),
  completion_notes: z.string().nullable(),
  completion_document_id: uuidSchema.nullable(),
  completion_document_title: z.string().nullable(),
  completed_at: z.coerce.date().nullable(),
  version: z.number().int().positive(),
});
const dispatchCardRowSchema = z.object({
  id: uuidSchema,
  order_id: uuidSchema.nullable(),
  order_number: z.string().nullable(),
  client_name_snapshot: z.string(),
  object_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  contact_name_snapshot: z.string().nullable(),
  contact_phone_snapshot: z.string().nullable(),
  scheduled_start_at: z.coerce.date(),
  scheduled_end_at: z.coerce.date(),
  timezone: z.string(),
  status: z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]),
  assigned_master_id: uuidSchema.nullable(),
  order_master_id: uuidSchema.nullable(),
  master_name_snapshot: z.string().nullable(),
  master_phone_snapshot: z.string().nullable(),
  master_payment_snapshot_minor: z.union([z.null(), z.string().regex(/^\d+$/), z.bigint(), z.number().int().nonnegative()]),
  notes: z.string().nullable(),
  services: z.array(z.object({
    name: z.string(),
    quantity: z.string(),
    note: z.string().nullable(),
  })),
});

export class VisitNotFoundError extends Error {
  constructor() { super("Service visit was not found."); this.name = "VisitNotFoundError"; }
}

export class VisitVersionConflictError extends Error {
  constructor() { super("Service visit was changed by another member."); this.name = "VisitVersionConflictError"; }
}

export class VisitImmutableError extends Error {
  constructor() { super("Completed or cancelled visits cannot be rescheduled."); this.name = "VisitImmutableError"; }
}

export class VisitClosingDocumentRequiredError extends Error {
  constructor() { super("A closing document is required to complete the visit."); this.name = "VisitClosingDocumentRequiredError"; }
}

export class VisitStateTransitionError extends Error {
  constructor() { super("The visit cannot enter the requested state."); this.name = "VisitStateTransitionError"; }
}

export class VisitReferenceError extends Error {
  constructor(readonly field: "order" | "master") { super(`The selected ${field} is unavailable.`); this.name = "VisitReferenceError"; }
}

export class VisitScheduleConflictError extends Error {
  constructor() { super("The selected master already has a visit during this time."); this.name = "VisitScheduleConflictError"; }
}

export class VisitDuplicateError extends Error {
  constructor() { super("This order already has a visit at the selected time."); this.name = "VisitDuplicateError"; }
}

export class VisitRescheduleReasonRequiredError extends Error {
  constructor() { super("A reason is required when the visit schedule changes."); this.name = "VisitRescheduleReasonRequiredError"; }
}

export class VisitScheduleUnchangedError extends Error {
  constructor() { super("The requested visit schedule matches the current schedule."); this.name = "VisitScheduleUnchangedError"; }
}

function requireVisitRead(member: AuthenticatedMember) {
  requirePermission(member, "visits.read");
  if (member.role === "master") throw new AuthorizationError();
}

function requireAssignedMaster(member: AuthenticatedMember, permission: "visits.read" | "visits.write") {
  requirePermission(member, permission);
  if (member.role !== "master" || !member.masterId) throw new AuthorizationError();
  return member.masterId;
}

function masterVisitScope(member: AuthenticatedMember, permission: "visits.read" | "visits.write") {
  requirePermission(member, permission);
  if (member.role !== "master") return null;
  if (!member.masterId) throw new AuthorizationError();
  return member.masterId;
}

function mapVisit(row: unknown): ServiceVisit {
  const visit = visitRowSchema.parse(row);
  return {
    id: visit.id,
    seriesId: visit.series_id,
    occurrenceNumber: visit.occurrence_number,
    orderId: visit.order_id,
    orderNumber: visit.order_number,
    client: visit.client_name_snapshot,
    object: visit.object_name_snapshot,
    address: visit.object_address_snapshot,
    scheduledStartAt: visit.scheduled_start_at.toISOString(),
    scheduledEndAt: visit.scheduled_end_at.toISOString(),
    timezone: visit.timezone,
    statusCode: visit.status,
    status: visitStatusLabels[visit.status],
    copyable: visit.is_copyable,
    assignedMasterId: visit.assigned_master_id,
    master: visit.master_name_snapshot,
    masterPhone: visit.master_phone_snapshot,
    cancellationReason: visit.cancellation_reason,
    notes: visit.notes,
    completionNotes: visit.completion_notes,
    completionDocumentId: visit.completion_document_id,
    completionDocumentTitle: visit.completion_document_title,
    completedAt: visit.completed_at?.toISOString() ?? null,
    version: visit.version,
  };
}

function databaseConstraint(error: unknown, code: "23505" | "23P01") {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== code) return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

export async function listOrderVisits(member: AuthenticatedMember, orderId: string): Promise<ServiceVisit[]> {
  requireVisitRead(member);
  const sql = getDatabase();
  const rows = await sql`SELECT service_visits.id, service_visits.series_id, service_visits.occurrence_number, service_visits.order_id, orders.order_number,
    service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot,
    service_visits.scheduled_start_at, service_visits.scheduled_end_at, organizations.timezone,
    (service_visits.status IN ('planned', 'confirmed') AND service_visits.scheduled_start_at >= now()) AS is_copyable,
    service_visits.status, service_visits.assigned_master_id, service_visits.master_name_snapshot,
    service_visits.master_phone_snapshot, service_visits.cancellation_reason, service_visits.notes,
    service_visits.completion_notes, service_visits.completion_document_id,
    completion_documents.title AS completion_document_title, service_visits.completed_at, service_visits.version
    FROM service_visits
    JOIN organizations ON organizations.id = service_visits.organization_id
    LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
    LEFT JOIN documents AS completion_documents ON completion_documents.organization_id = service_visits.organization_id
      AND completion_documents.id = service_visits.completion_document_id
    WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.order_id = ${orderId}
    ORDER BY service_visits.scheduled_start_at`;
  return rows.map(mapVisit);
}

const orderVisitHistoryLimit = 500;

export async function listOrderVisitHistory(member: AuthenticatedMember, orderId: string): Promise<VisitHistoryFeed> {
  requireVisitRead(member);
  const sql = getDatabase();
  const rows = await sql`SELECT service_visit_events.id, service_visit_events.visit_id,
      service_visit_events.event_type, service_visit_events.before_state, service_visit_events.after_state,
      service_visit_events.reason, service_visit_events.created_at,
      organization_members.display_name AS actor_name,
      count(*) OVER()::integer AS total_count
    FROM service_visit_events
    JOIN service_visits ON service_visits.organization_id = service_visit_events.organization_id
      AND service_visits.id = service_visit_events.visit_id
    JOIN organization_members ON organization_members.organization_id = service_visit_events.organization_id
      AND organization_members.id = service_visit_events.actor_id
    WHERE service_visit_events.organization_id = ${member.organizationId}
      AND service_visits.order_id = ${orderId}
    ORDER BY service_visit_events.created_at DESC, service_visit_events.id DESC
    LIMIT ${orderVisitHistoryLimit}`;
  return buildVisitHistoryFeed(rows, orderVisitHistoryLimit);
}

export async function listVisits(member: AuthenticatedMember, rangeStart: string, rangeEnd: string): Promise<ServiceVisit[]> {
  requireVisitRead(member);
  const bounds = z.object({ start: z.coerce.date(), end: z.coerce.date() }).parse({ start: rangeStart, end: rangeEnd });
  if (bounds.end <= bounds.start) throw new RangeError("Visit range end must be after its start.");
  const sql = getDatabase();
  const rows = await sql`SELECT service_visits.id, service_visits.series_id, service_visits.occurrence_number, service_visits.order_id, orders.order_number,
    service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot,
    service_visits.scheduled_start_at, service_visits.scheduled_end_at, organizations.timezone,
    service_visits.status, service_visits.assigned_master_id, service_visits.master_name_snapshot,
    service_visits.master_phone_snapshot, service_visits.cancellation_reason, service_visits.notes,
    service_visits.completion_notes, service_visits.completion_document_id,
    completion_documents.title AS completion_document_title, service_visits.completed_at, service_visits.version
    FROM service_visits
    JOIN organizations ON organizations.id = service_visits.organization_id
    LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
    LEFT JOIN documents AS completion_documents ON completion_documents.organization_id = service_visits.organization_id
      AND completion_documents.id = service_visits.completion_document_id
    WHERE service_visits.organization_id = ${member.organizationId}
      AND service_visits.scheduled_start_at < ${bounds.end}
      AND service_visits.scheduled_end_at > ${bounds.start}
    ORDER BY service_visits.scheduled_start_at
    LIMIT 500`;
  return rows.map(mapVisit);
}

export async function listAssignedMasterVisits(member: AuthenticatedMember): Promise<ServiceVisit[]> {
  const masterId = requireAssignedMaster(member, "visits.read");
  const sql = getDatabase();
  const rows = await sql`SELECT service_visits.id, service_visits.series_id, service_visits.occurrence_number, service_visits.order_id, orders.order_number,
    service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot,
    service_visits.scheduled_start_at, service_visits.scheduled_end_at, organizations.timezone,
    service_visits.status, service_visits.assigned_master_id, service_visits.master_name_snapshot,
    service_visits.master_phone_snapshot, service_visits.cancellation_reason, service_visits.notes,
    service_visits.completion_notes, service_visits.completion_document_id,
    completion_documents.title AS completion_document_title, service_visits.completed_at, service_visits.version
    FROM service_visits
    JOIN organizations ON organizations.id = service_visits.organization_id
    LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
    LEFT JOIN documents AS completion_documents ON completion_documents.organization_id = service_visits.organization_id
      AND completion_documents.id = service_visits.completion_document_id
    WHERE service_visits.organization_id = ${member.organizationId}
      AND service_visits.assigned_master_id = ${masterId}
      AND service_visits.scheduled_end_at >= now() - interval '7 days'
      AND service_visits.scheduled_start_at < now() + interval '45 days'
    ORDER BY service_visits.scheduled_start_at
    LIMIT 150`;
  return rows.map(mapVisit);
}

export async function getVisitDispatchCard(member: AuthenticatedMember, visitId: string): Promise<VisitDispatchCard> {
  const assignedMasterId = masterVisitScope(member, "visits.read");
  const sql = getDatabase();
  const rows = await sql`SELECT service_visits.id, service_visits.order_id, orders.order_number,
    service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot,
    orders.contact_name_snapshot, orders.contact_phone_snapshot,
    service_visits.scheduled_start_at, service_visits.scheduled_end_at, organizations.timezone,
    service_visits.status, service_visits.assigned_master_id, orders.assigned_master_id AS order_master_id,
    service_visits.master_name_snapshot, service_visits.master_phone_snapshot,
    orders.master_payment_snapshot_minor, service_visits.notes,
    coalesce(services.items, '[]'::json) AS services
    FROM service_visits
    JOIN organizations ON organizations.id = service_visits.organization_id
    LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'name', order_services.service_name_snapshot,
        'quantity', order_services.quantity::text,
        'note', order_services.note
      ) ORDER BY order_services.position) AS items
      FROM order_services
      WHERE order_services.organization_id = service_visits.organization_id
        AND order_services.order_id = service_visits.order_id
    ) services ON true
    WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.id = ${visitId}
      AND (${assignedMasterId === null} OR service_visits.assigned_master_id = ${assignedMasterId})`;
  if (!rows.length) throw new VisitNotFoundError();
  const row = dispatchCardRowSchema.parse(rows[0]);
  const canViewMasterPayment = hasPermission(member.role, "finance.read") || member.role === "master";
  const masterPaymentMatchesVisit = row.assigned_master_id !== null && row.assigned_master_id === row.order_master_id;
  return {
    visitId: row.id,
    orderId: row.order_id,
    orderNumber: row.order_number,
    client: row.client_name_snapshot,
    object: row.object_name_snapshot,
    address: row.object_address_snapshot,
    contactName: row.contact_name_snapshot,
    contactPhone: row.contact_phone_snapshot,
    scheduledStartAt: row.scheduled_start_at.toISOString(),
    scheduledEndAt: row.scheduled_end_at.toISOString(),
    timezone: row.timezone,
    status: visitStatusLabels[row.status],
    master: row.master_name_snapshot,
    masterPhone: row.master_phone_snapshot,
    ...(canViewMasterPayment ? {
      masterPaymentMinor: masterPaymentMatchesVisit && row.master_payment_snapshot_minor !== null
        ? minorUnitsToSafeNumber(row.master_payment_snapshot_minor)
        : null,
    } : {}),
    notes: row.notes,
    services: row.services,
  };
}

export async function createVisit(member: AuthenticatedMember, input: CreateVisitInput) {
  requirePermission(member, "visits.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'service_visits.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "service_visits.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(existing.entity_id);
      }
      const [order] = await transaction`SELECT id, object_id, order_number, client_name_snapshot, object_name_snapshot, object_address_snapshot
        FROM orders WHERE organization_id = ${member.organizationId} AND id = ${input.orderId}`;
      if (!order) throw new VisitReferenceError("order");
      const orderNumber = z.string().parse(order.order_number);
      const masterRows = input.assignedMasterId
        ? await transaction`SELECT id, full_name, phone FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active`
        : [];
      if (input.assignedMasterId && !masterRows.length) throw new VisitReferenceError("master");
      const master = masterRows[0] ?? null;
      const [rangeRow] = await transaction`SELECT
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS start_at,
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) + make_interval(mins => ${input.durationMinutes}) AS end_at
        FROM organizations WHERE id = ${member.organizationId}`;
      const range = timestampRangeSchema.parse(rangeRow);
      if (input.assignedMasterId) {
        const conflicts = await transaction`SELECT id FROM service_visits
          WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${input.assignedMasterId}
            AND status <> 'cancelled' AND scheduled_start_at < ${range.end_at} AND scheduled_end_at > ${range.start_at}
          LIMIT 1`;
        if (conflicts.length) throw new VisitScheduleConflictError();
      }
      const [visit] = await transaction`INSERT INTO service_visits (
        organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
        client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot,
        notes, created_by, updated_by
      ) VALUES (
        ${member.organizationId}, ${input.orderId}, ${order.object_id}, ${input.assignedMasterId}, ${range.start_at}, ${range.end_at}, 'planned',
        ${order.client_name_snapshot}, ${order.object_name_snapshot}, ${order.object_address_snapshot}, ${master?.full_name ?? null},
        ${master?.phone ?? null}, ${input.notes}, ${member.memberId}, ${member.memberId}
      ) RETURNING id`;
      const visitId = uuidSchema.parse(visit.id);
      const afterState = { scheduledStartAt: range.start_at.toISOString(), scheduledEndAt: range.end_at.toISOString(), status: "planned", assignedMasterId: input.assignedMasterId, notes: input.notes };
      await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
        VALUES (${member.organizationId}, ${visitId}, ${member.memberId}, 'created', ${transaction.json(afterState)})`;
      await transaction`INSERT INTO tasks (
        organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, related_visit_id,
        source, reminder_kind, created_by, updated_by
      ) VALUES (
        ${member.organizationId}, ${`Подготовить выезд ${orderNumber}`}, 'Автоматическое напоминание по дате выезда.', 'high',
        ${range.start_at} - interval '1 day', ${member.memberId}, ${input.orderId}, ${visitId},
        'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
      )`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${visitId} WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.create', 'service_visit', ${visitId}, ${transaction.json({ orderId: input.orderId, ...afterState })})`;
      return visitId;
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new VisitDuplicateError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new VisitScheduleConflictError();
    throw error;
  }
}

export async function createVisitSeries(member: AuthenticatedMember, input: CreateVisitSeriesInput) {
  requirePermission(member, "visits.write");
  const localDates = generateVisitRecurrenceDates(input.startsOn, input.endsOn, input.frequencyUnit, input.frequencyInterval);
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'service_visit_series.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existingRequest] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existingRequest?.operation !== "service_visit_series.create" || !existingRequest.entity_id) {
          throw new Error("Idempotency key is already used by another operation.");
        }
        const [existingSeries] = await transaction`SELECT count(*)::integer AS visit_count FROM service_visits
          WHERE organization_id = ${member.organizationId} AND series_id = ${existingRequest.entity_id}`;
        return { seriesId: uuidSchema.parse(existingRequest.entity_id), visitCount: z.number().int().positive().parse(existingSeries?.visit_count) };
      }

      const [order] = await transaction`SELECT id, object_id, order_number, client_name_snapshot, object_name_snapshot, object_address_snapshot
        FROM orders WHERE organization_id = ${member.organizationId} AND id = ${input.orderId}`;
      if (!order) throw new VisitReferenceError("order");
      const orderNumber = z.string().parse(order.order_number);
      const masterRows = input.assignedMasterId
        ? await transaction`SELECT id, full_name, phone FROM masters
          WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active`
        : [];
      if (input.assignedMasterId && !masterRows.length) throw new VisitReferenceError("master");
      const master = masterRows[0] ?? null;
      const datePayload = localDates.map((localDate) => ({ local_date: localDate }));
      const rangeRows = await transaction`SELECT occurrence.local_date,
        ((occurrence.local_date || ' ' || ${input.localTime})::timestamp AT TIME ZONE organizations.timezone) AS start_at,
        ((occurrence.local_date || ' ' || ${input.localTime})::timestamp AT TIME ZONE organizations.timezone) + make_interval(mins => ${input.durationMinutes}) AS end_at
        FROM organizations
        CROSS JOIN jsonb_to_recordset(${transaction.json(datePayload)}::jsonb) AS occurrence(local_date text)
        WHERE organizations.id = ${member.organizationId}
        ORDER BY occurrence.local_date`;
      const ranges = rangeRows.map((row) => datedTimestampRangeSchema.parse(row));
      const [series] = await transaction`INSERT INTO service_visit_series (
        organization_id, order_id, object_id, assigned_master_id, frequency_unit, frequency_interval,
        starts_on, ends_on, local_time, duration_minutes, notes, created_by, updated_by
      ) VALUES (
        ${member.organizationId}, ${input.orderId}, ${order.object_id}, ${input.assignedMasterId}, ${input.frequencyUnit},
        ${input.frequencyInterval}, ${input.startsOn}, ${input.endsOn}, ${input.localTime}, ${input.durationMinutes},
        ${input.notes}, ${member.memberId}, ${member.memberId}
      ) RETURNING id`;
      const seriesId = uuidSchema.parse(series.id);
      const visitPayload = ranges.map((range, index) => ({
        occurrence_number: index + 1,
        scheduled_start_at: range.start_at.toISOString(),
        scheduled_end_at: range.end_at.toISOString(),
      }));
      await transaction`INSERT INTO service_visits (
        organization_id, order_id, object_id, assigned_master_id, series_id, occurrence_number,
        scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot,
        object_address_snapshot, master_name_snapshot, master_phone_snapshot, notes, created_by, updated_by
      ) SELECT
        ${member.organizationId}, ${input.orderId}, ${order.object_id}, ${input.assignedMasterId}, ${seriesId},
        occurrence.occurrence_number, occurrence.scheduled_start_at, occurrence.scheduled_end_at, 'planned',
        ${order.client_name_snapshot}, ${order.object_name_snapshot}, ${order.object_address_snapshot},
        ${master?.full_name ?? null}, ${master?.phone ?? null}, ${input.notes}, ${member.memberId}, ${member.memberId}
        FROM jsonb_to_recordset(${transaction.json(visitPayload)}::jsonb)
          AS occurrence(occurrence_number smallint, scheduled_start_at timestamptz, scheduled_end_at timestamptz)`;
      await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
        SELECT organization_id, id, ${member.memberId}, 'created', jsonb_build_object(
          'seriesId', series_id, 'occurrenceNumber', occurrence_number, 'scheduledStartAt', scheduled_start_at,
          'scheduledEndAt', scheduled_end_at, 'status', status, 'assignedMasterId', assigned_master_id, 'notes', notes
        ) FROM service_visits WHERE organization_id = ${member.organizationId} AND series_id = ${seriesId}`;
      await transaction`INSERT INTO tasks (
        organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, related_visit_id,
        source, reminder_kind, created_by, updated_by
      ) SELECT
        service_visits.organization_id, ${`Подготовить выезд ${orderNumber}`}, 'Автоматическое напоминание по дате выезда.',
        'high', service_visits.scheduled_start_at - interval '1 day', ${member.memberId}, service_visits.order_id,
        service_visits.id, 'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
        FROM service_visits
        WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.series_id = ${seriesId}`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${seriesId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit_series.create', 'service_visit_series',
          ${seriesId}, ${transaction.json({ orderId: input.orderId, frequencyUnit: input.frequencyUnit, frequencyInterval: input.frequencyInterval, startsOn: input.startsOn, endsOn: input.endsOn, localTime: input.localTime, durationMinutes: input.durationMinutes, assignedMasterId: input.assignedMasterId, visitCount: ranges.length })})`;
      return { seriesId, visitCount: ranges.length };
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new VisitDuplicateError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new VisitScheduleConflictError();
    throw error;
  }
}

export async function updateVisit(member: AuthenticatedMember, input: UpdateVisitInput) {
  requirePermission(member, "visits.write");
  if (input.status === "completed") throw new VisitClosingDocumentRequiredError();
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [existing] = await transaction`SELECT scheduled_start_at, scheduled_end_at, status, assigned_master_id, cancellation_reason, notes, version
        FROM service_visits WHERE organization_id = ${member.organizationId} AND id = ${input.visitId} FOR UPDATE`;
      if (!existing) throw new VisitNotFoundError();
      if (z.number().int().parse(existing.version) !== input.expectedVersion) throw new VisitVersionConflictError();
      if (existing.status === "completed") throw new VisitImmutableError();
      const masterRows = input.assignedMasterId
        ? await transaction`SELECT id, full_name, phone FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.assignedMasterId} AND active`
        : [];
      if (input.assignedMasterId && !masterRows.length) throw new VisitReferenceError("master");
      const master = masterRows[0] ?? null;
      const [rangeRow] = await transaction`SELECT
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS start_at,
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) + make_interval(mins => ${input.durationMinutes}) AS end_at
        FROM organizations WHERE id = ${member.organizationId}`;
      const range = timestampRangeSchema.parse(rangeRow);
      const previousStart = z.coerce.date().parse(existing.scheduled_start_at);
      const previousEnd = z.coerce.date().parse(existing.scheduled_end_at);
      const scheduleChanged = previousStart.getTime() !== range.start_at.getTime() || previousEnd.getTime() !== range.end_at.getTime();
      if (scheduleChanged && !input.rescheduleReason) throw new VisitRescheduleReasonRequiredError();
      if (input.assignedMasterId) {
        const conflicts = await transaction`SELECT id FROM service_visits
          WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${input.assignedMasterId}
            AND id <> ${input.visitId} AND status <> 'cancelled'
            AND scheduled_start_at < ${range.end_at} AND scheduled_end_at > ${range.start_at}
          LIMIT 1`;
        if (conflicts.length) throw new VisitScheduleConflictError();
      }
      const beforeState = {
        scheduledStartAt: previousStart.toISOString(),
        scheduledEndAt: previousEnd.toISOString(),
        status: z.string().parse(existing.status),
        assignedMasterId: z.string().uuid().nullable().parse(existing.assigned_master_id),
        cancellationReason: z.string().nullable().parse(existing.cancellation_reason),
        notes: z.string().nullable().parse(existing.notes),
        version: input.expectedVersion,
      };
      const [updated] = await transaction`UPDATE service_visits SET scheduled_start_at = ${range.start_at}, scheduled_end_at = ${range.end_at},
        status = ${input.status}, assigned_master_id = ${input.assignedMasterId}, master_name_snapshot = ${master?.full_name ?? null},
        master_phone_snapshot = ${master?.phone ?? null}, cancellation_reason = ${input.status === "cancelled" ? input.cancellationReason : null},
        notes = ${input.notes}, version = version + 1, updated_by = ${member.memberId}, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.visitId} RETURNING version`;
      await transaction`UPDATE tasks SET
        due_at = ${range.start_at} - interval '1 day',
        status = CASE
          WHEN tasks.status = 'completed' THEN 'completed'
          WHEN ${input.status} = 'completed' THEN 'completed'
          WHEN ${input.status} = 'cancelled' THEN 'cancelled'
          ELSE 'open'
        END,
        completed_at = CASE
          WHEN tasks.status = 'completed' THEN tasks.completed_at
          WHEN ${input.status} = 'completed' THEN now()
          ELSE NULL
        END,
        completed_by = CASE
          WHEN tasks.status = 'completed' THEN tasks.completed_by
          WHEN ${input.status} = 'completed' THEN ${member.memberId}
          ELSE NULL
        END,
        cancellation_reason = CASE
          WHEN tasks.status = 'completed' THEN tasks.cancellation_reason
          WHEN ${input.status} = 'cancelled' THEN ${input.cancellationReason}
          ELSE NULL
        END,
        cancelled_at = CASE
          WHEN tasks.status = 'completed' THEN tasks.cancelled_at
          WHEN ${input.status} = 'cancelled' THEN now()
          ELSE NULL
        END,
        cancelled_by = CASE
          WHEN tasks.status = 'completed' THEN tasks.cancelled_by
          WHEN ${input.status} = 'cancelled' THEN ${member.memberId}
          ELSE NULL
        END,
        version = version + 1,
        updated_by = ${member.memberId},
        updated_at = now()
        WHERE organization_id = ${member.organizationId} AND related_visit_id = ${input.visitId}
          AND source = 'visit_reminder' AND reminder_kind = 'prepare_visit'`;
      const afterState = { scheduledStartAt: range.start_at.toISOString(), scheduledEndAt: range.end_at.toISOString(), status: input.status, assignedMasterId: input.assignedMasterId, cancellationReason: input.status === "cancelled" ? input.cancellationReason : null, notes: input.notes, version: updated.version };
      const eventTypes = new Set<string>();
      if (scheduleChanged) eventTypes.add("schedule_changed");
      if (beforeState.status !== afterState.status) eventTypes.add("status_changed");
      if (beforeState.assignedMasterId !== afterState.assignedMasterId) eventTypes.add("master_changed");
      if (beforeState.notes !== afterState.notes) eventTypes.add("notes_changed");
      for (const eventType of eventTypes) {
        const reason = eventType === "schedule_changed"
          ? input.rescheduleReason
          : eventType === "status_changed" && input.status === "cancelled"
            ? input.cancellationReason
            : null;
        await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, before_state, after_state, reason)
          VALUES (${member.organizationId}, ${input.visitId}, ${member.memberId}, ${eventType}, ${transaction.json(beforeState)}, ${transaction.json(afterState)}, ${reason})`;
      }
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.update', 'service_visit', ${input.visitId}, ${transaction.json({ before: beforeState, after: afterState, rescheduleReason: scheduleChanged ? input.rescheduleReason : null })})`;
      return z.number().int().positive().parse(updated.version);
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new VisitDuplicateError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new VisitScheduleConflictError();
    throw error;
  }
}

type ValidatedClosingDocument = {
  filename: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
};

export async function visitCompletionExists(member: AuthenticatedMember, visitId: string, documentId: string) {
  const assignedMasterId = masterVisitScope(member, "visits.write");
  const sql = getDatabase();
  const rows = await sql`SELECT id FROM service_visits
    WHERE organization_id = ${member.organizationId} AND id = ${visitId}
      AND (${assignedMasterId === null} OR assigned_master_id = ${assignedMasterId})
      AND status = 'completed' AND completion_document_id = ${documentId}`;
  return rows.length > 0;
}

export async function completeVisitWithClosingDocument(
  member: AuthenticatedMember,
  input: CompleteVisitInput & ValidatedClosingDocument,
) {
  const assignedMasterId = masterVisitScope(member, "visits.write");
  if (member.role !== "master") requirePermission(member, "documents.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [visit] = await transaction`SELECT service_visits.id, service_visits.order_id, service_visits.status,
        service_visits.version, service_visits.scheduled_start_at, service_visits.scheduled_end_at,
        service_visits.assigned_master_id, service_visits.notes, service_visits.completion_document_id,
        orders.client_id, orders.object_id, orders.order_number
      FROM service_visits
      JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
      WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.id = ${input.visitId}
        AND (${assignedMasterId === null} OR service_visits.assigned_master_id = ${assignedMasterId})
      FOR UPDATE OF service_visits`;
    if (!visit) throw new VisitNotFoundError();

    const currentVersion = z.number().int().positive().parse(visit.version);
    const currentStatus = z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]).parse(visit.status);
    const existingCompletionDocumentId = uuidSchema.nullable().parse(visit.completion_document_id);
    if (currentStatus === "completed" && existingCompletionDocumentId === input.idempotencyKey) {
      return { visitId: input.visitId, orderId: uuidSchema.parse(visit.order_id), documentId: input.idempotencyKey, version: currentVersion };
    }
    if (currentVersion !== input.expectedVersion) throw new VisitVersionConflictError();
    if (currentStatus === "completed" || currentStatus === "cancelled") throw new VisitImmutableError();

    const duplicateDocument = await transaction`SELECT id FROM documents
      WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;
    if (duplicateDocument.length) throw new Error("Closing document id is already used.");

    const orderId = uuidSchema.parse(visit.order_id);
    const clientId = uuidSchema.parse(visit.client_id);
    const objectId = uuidSchema.parse(visit.object_id);
    await transaction`INSERT INTO documents (
        id, organization_id, client_id, object_id, order_id, visit_id, title, category, description, created_by
      ) VALUES (
        ${input.idempotencyKey}, ${member.organizationId}, ${clientId}, ${objectId}, ${orderId}, ${input.visitId},
        ${input.actTitle}, 'act', ${input.completionNotes}, ${member.memberId}
      )`;
    const [documentVersion] = await transaction`INSERT INTO document_versions (
        organization_id, document_id, version_number, original_filename, storage_key, mime_type, extension,
        size_bytes, sha256, uploaded_by
      ) VALUES (
        ${member.organizationId}, ${input.idempotencyKey}, 1, ${input.filename}, ${input.storageKey}, ${input.mimeType},
        ${input.extension}, ${input.sizeBytes}, ${input.sha256}, ${member.memberId}
      ) RETURNING id`;
    const documentVersionId = z.object({ id: uuidSchema }).parse(documentVersion).id;
    await transaction`UPDATE documents SET current_version_id = ${documentVersionId}
      WHERE organization_id = ${member.organizationId} AND id = ${input.idempotencyKey}`;

    const [updatedVisit] = await transaction`UPDATE service_visits SET
        status = 'completed', completion_notes = ${input.completionNotes},
        completion_document_id = ${input.idempotencyKey}, completed_at = now(), completed_by = ${member.memberId},
        version = version + 1, updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.visitId}
      RETURNING version, completed_at`;
    const completedVersion = z.number().int().positive().parse(updatedVisit.version);
    const beforeState = {
      scheduledStartAt: z.coerce.date().parse(visit.scheduled_start_at).toISOString(),
      scheduledEndAt: z.coerce.date().parse(visit.scheduled_end_at).toISOString(),
      status: currentStatus,
      assignedMasterId: uuidSchema.nullable().parse(visit.assigned_master_id),
      notes: z.string().nullable().parse(visit.notes),
      version: currentVersion,
    };
    const afterState = {
      ...beforeState,
      status: "completed",
      completionDocumentId: input.idempotencyKey,
      completionNotes: input.completionNotes,
      completedAt: z.coerce.date().parse(updatedVisit.completed_at).toISOString(),
      version: completedVersion,
    };

    await transaction`UPDATE tasks SET status = 'completed', completed_at = coalesce(completed_at, now()),
        completed_by = coalesce(completed_by, ${member.memberId}), version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND related_visit_id = ${input.visitId}
        AND source = 'visit_reminder' AND reminder_kind = 'prepare_visit' AND status <> 'completed'`;
    await transaction`INSERT INTO service_visit_events (
        organization_id, visit_id, actor_id, event_type, before_state, after_state
      ) VALUES (
        ${member.organizationId}, ${input.visitId}, ${member.memberId}, 'status_changed',
        ${transaction.json(beforeState)}, ${transaction.json(afterState)}
      )`;
    await transaction`INSERT INTO audit_events (
        organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes
      ) VALUES
      (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'document.created', 'document',
        ${input.idempotencyKey}, ${transaction.json({ orderId, visitId: input.visitId, category: "act", filename: input.filename, sizeBytes: input.sizeBytes, sha256: input.sha256 })}),
      (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.completed', 'service_visit',
        ${input.visitId}, ${transaction.json({ before: beforeState, after: afterState })})`;

    return { visitId: input.visitId, orderId, documentId: input.idempotencyKey, version: completedVersion };
  });
}

export async function startAssignedMasterVisit(member: AuthenticatedMember, input: StartVisitInput) {
  const masterId = requireAssignedMaster(member, "visits.write");
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [visit] = await transaction`SELECT id, order_id, status, version, scheduled_start_at, scheduled_end_at,
        assigned_master_id, notes
      FROM service_visits
      WHERE organization_id = ${member.organizationId} AND id = ${input.visitId}
        AND assigned_master_id = ${masterId}
      FOR UPDATE`;
    if (!visit) throw new VisitNotFoundError();

    const currentVersion = z.number().int().positive().parse(visit.version);
    const currentStatus = z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]).parse(visit.status);
    if (currentStatus === "in_progress") return { version: currentVersion, orderId: uuidSchema.nullable().parse(visit.order_id) };
    if (currentVersion !== input.expectedVersion) throw new VisitVersionConflictError();
    if (currentStatus !== "planned" && currentStatus !== "confirmed") throw new VisitStateTransitionError();

    const [updated] = await transaction`UPDATE service_visits SET status = 'in_progress', version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.visitId}
        AND assigned_master_id = ${masterId}
      RETURNING version`;
    const version = z.number().int().positive().parse(updated.version);
    const beforeState = {
      scheduledStartAt: z.coerce.date().parse(visit.scheduled_start_at).toISOString(),
      scheduledEndAt: z.coerce.date().parse(visit.scheduled_end_at).toISOString(),
      status: currentStatus,
      assignedMasterId: masterId,
      notes: z.string().nullable().parse(visit.notes),
      version: currentVersion,
    };
    const afterState = { ...beforeState, status: "in_progress", version };
    await transaction`INSERT INTO service_visit_events (
        organization_id, visit_id, actor_id, event_type, before_state, after_state
      ) VALUES (
        ${member.organizationId}, ${input.visitId}, ${member.memberId}, 'status_changed',
        ${transaction.json(beforeState)}, ${transaction.json(afterState)}
      )`;
    await transaction`INSERT INTO audit_events (
        organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes
      ) VALUES (
        ${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.started', 'service_visit',
        ${input.visitId}, ${transaction.json({ before: beforeState, after: afterState })}
      )`;
    return { version, orderId: uuidSchema.nullable().parse(visit.order_id) };
  });
}

export async function rescheduleVisit(member: AuthenticatedMember, input: RescheduleVisitInput) {
  requirePermission(member, "visits.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [existing] = await transaction`SELECT order_id, scheduled_start_at, scheduled_end_at, status,
        assigned_master_id, version
        FROM service_visits
        WHERE organization_id = ${member.organizationId} AND id = ${input.visitId}
        FOR UPDATE`;
      if (!existing) throw new VisitNotFoundError();
      if (z.number().int().parse(existing.version) !== input.expectedVersion) throw new VisitVersionConflictError();
      const status = z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]).parse(existing.status);
      if (status === "completed" || status === "cancelled") throw new VisitImmutableError();
      const previousStart = z.coerce.date().parse(existing.scheduled_start_at);
      const previousEnd = z.coerce.date().parse(existing.scheduled_end_at);
      const durationMinutes = Math.round((previousEnd.getTime() - previousStart.getTime()) / 60_000);
      const [rangeRow] = await transaction`SELECT
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) AS start_at,
        ((${input.localDate} || ' ' || ${input.localTime})::timestamp AT TIME ZONE timezone) + make_interval(mins => ${durationMinutes}) AS end_at
        FROM organizations WHERE id = ${member.organizationId}`;
      const range = timestampRangeSchema.parse(rangeRow);
      if (previousStart.getTime() === range.start_at.getTime() && previousEnd.getTime() === range.end_at.getTime()) {
        throw new VisitScheduleUnchangedError();
      }
      const assignedMasterId = z.string().uuid().nullable().parse(existing.assigned_master_id);
      if (assignedMasterId) {
        const conflicts = await transaction`SELECT id FROM service_visits
          WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${assignedMasterId}
            AND id <> ${input.visitId} AND status <> 'cancelled'
            AND scheduled_start_at < ${range.end_at} AND scheduled_end_at > ${range.start_at}
          LIMIT 1`;
        if (conflicts.length) throw new VisitScheduleConflictError();
      }
      const [updated] = await transaction`UPDATE service_visits SET
        scheduled_start_at = ${range.start_at}, scheduled_end_at = ${range.end_at}, version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.visitId}
        RETURNING version`;
      await transaction`UPDATE tasks SET due_at = ${range.start_at} - interval '1 day', version = version + 1,
        updated_by = ${member.memberId}, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND related_visit_id = ${input.visitId}
          AND source = 'visit_reminder' AND reminder_kind = 'prepare_visit' AND status = 'open'`;
      const beforeState = { scheduledStartAt: previousStart.toISOString(), scheduledEndAt: previousEnd.toISOString() };
      const afterState = { scheduledStartAt: range.start_at.toISOString(), scheduledEndAt: range.end_at.toISOString() };
      await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, before_state, after_state, reason)
        VALUES (${member.organizationId}, ${input.visitId}, ${member.memberId}, 'schedule_changed',
          ${transaction.json(beforeState)}, ${transaction.json(afterState)}, ${input.rescheduleReason})`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'service_visit.reschedule', 'service_visit',
          ${input.visitId}, ${transaction.json({ before: beforeState, after: afterState, rescheduleReason: input.rescheduleReason })})`;
      return {
        version: z.number().int().positive().parse(updated.version),
        scheduledStartAt: range.start_at.toISOString(),
        scheduledEndAt: range.end_at.toISOString(),
        orderId: z.string().uuid().nullable().parse(existing.order_id),
      };
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new VisitDuplicateError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new VisitScheduleConflictError();
    throw error;
  }
}
