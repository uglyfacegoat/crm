import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CopyOrderInput } from "./schemas";
import { OrderNotFoundError, OrderReferenceError, OrderVersionConflictError } from "./repository";

const uuidSchema = z.string().uuid();
const sourceOrderSchema = z.object({
  id: uuidSchema,
  client_id: uuidSchema,
  object_id: uuidSchema,
  client_contact_id: uuidSchema.nullable(),
  assigned_master_id: uuidSchema.nullable(),
  master_payment_snapshot_minor: z.union([z.string(), z.bigint(), z.number()]).nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  client_name: z.string(),
  object_name: z.string(),
  object_address: z.string(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
});
const serviceSchema = z.object({
  id: uuidSchema,
  service_name_snapshot: z.string(),
  quantity: z.string(),
  unit_price_minor: z.union([z.string(), z.bigint(), z.number()]).transform(String),
  line_total_minor: z.union([z.string(), z.bigint(), z.number()]).transform(String),
  note: z.string().nullable(),
});
const expenseSchema = z.object({
  id: uuidSchema,
  category: z.string(),
  amount_minor: z.union([z.string(), z.bigint(), z.number()]).transform(String),
  note: z.string().nullable(),
});
const visitSchema = z.object({
  id: uuidSchema,
  scheduled_start_at: z.coerce.date(),
  scheduled_end_at: z.coerce.date(),
  local_date: z.string(),
  assigned_master_id: uuidSchema.nullable(),
  master_name: z.string().nullable(),
  master_phone: z.string().nullable(),
  master_active: z.boolean().nullable(),
  notes: z.string().nullable(),
});

export class OrderCopySelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderCopySelectionError";
  }
}

export class OrderCopyScheduleConflictError extends Error {
  constructor() {
    super("A copied visit conflicts with the selected master's schedule.");
    this.name = "OrderCopyScheduleConflictError";
  }
}

function databaseConstraint(error: unknown, expectedCode: "23505" | "23P01") {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== expectedCode) return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function dayDifference(targetDate: string, sourceDate: string) {
  const target = Date.parse(`${targetDate}T00:00:00Z`);
  const source = Date.parse(`${sourceDate}T00:00:00Z`);
  return Math.round((target - source) / 86_400_000);
}

export async function copyOrder(member: AuthenticatedMember, input: CopyOrderInput) {
  requirePermission(member, "orders.write");
  const sql = getDatabase();

  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'orders.copy')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "orders.copy" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(existing.entity_id);
      }

      const [sourceRow] = await transaction`SELECT orders.id, orders.client_id, orders.object_id, orders.client_contact_id,
        orders.assigned_master_id, orders.master_payment_snapshot_minor, orders.notes, orders.version,
        clients.legal_name AS client_name, client_objects.name AS object_name, client_objects.address AS object_address,
        client_contacts.full_name AS contact_name, client_contacts.phone AS contact_phone
        FROM orders
        JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
        JOIN client_objects ON client_objects.organization_id = orders.organization_id AND client_objects.id = orders.object_id
        LEFT JOIN client_contacts ON client_contacts.organization_id = orders.organization_id AND client_contacts.id = orders.client_contact_id
        WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${input.sourceOrderId}
        FOR UPDATE OF orders`;
      if (!sourceRow) throw new OrderNotFoundError();
      const source = sourceOrderSchema.parse(sourceRow);
      if (source.version !== input.expectedVersion) throw new OrderVersionConflictError();

      const serviceRows = await transaction`SELECT id, service_name_snapshot, quantity::text, unit_price_minor, line_total_minor, note
        FROM order_services
        WHERE organization_id = ${member.organizationId} AND order_id = ${source.id}
          AND id = ANY(${input.serviceIds}::uuid[])
        ORDER BY position`;
      if (serviceRows.length !== input.serviceIds.length) {
        throw new OrderCopySelectionError("Одна из выбранных услуг больше не относится к этому заказу.");
      }
      const services = serviceRows.map((row) => serviceSchema.parse(row));

      const expenseRows = input.expenseIds.length
        ? await transaction`SELECT id, category, amount_minor, note FROM order_expenses
            WHERE organization_id = ${member.organizationId} AND order_id = ${source.id}
              AND id = ANY(${input.expenseIds}::uuid[])
            ORDER BY occurred_on, created_at`
        : [];
      if (expenseRows.length !== input.expenseIds.length) {
        throw new OrderCopySelectionError("Один из выбранных расходов больше не относится к этому заказу.");
      }
      const expenses = expenseRows.map((row) => expenseSchema.parse(row));

      const [organization] = await transaction`SELECT timezone, (now() AT TIME ZONE timezone)::date::text AS today
        FROM organizations WHERE id = ${member.organizationId}`;
      const organizationTimezone = z.string().parse(organization?.timezone);
      const today = z.string().parse(organization?.today);
      if (input.visitIds.length && input.copyDate < today) {
        throw new OrderCopySelectionError("Будущие выезды нельзя переносить на прошедшую дату.");
      }

      const visitRows = input.visitIds.length
        ? await transaction`SELECT service_visits.id, service_visits.scheduled_start_at, service_visits.scheduled_end_at,
            (service_visits.scheduled_start_at AT TIME ZONE ${organizationTimezone})::date::text AS local_date,
            service_visits.assigned_master_id, masters.full_name AS master_name, masters.phone AS master_phone,
            masters.active AS master_active, service_visits.notes
            FROM service_visits
            LEFT JOIN masters ON masters.organization_id = service_visits.organization_id AND masters.id = service_visits.assigned_master_id
            WHERE service_visits.organization_id = ${member.organizationId} AND service_visits.order_id = ${source.id}
              AND service_visits.id = ANY(${input.visitIds}::uuid[])
              AND service_visits.status IN ('planned', 'confirmed') AND service_visits.scheduled_start_at >= now()
            ORDER BY service_visits.scheduled_start_at`
        : [];
      if (visitRows.length !== input.visitIds.length) {
        throw new OrderCopySelectionError("Копировать можно только актуальные будущие выезды этого заказа.");
      }
      const visits = visitRows.map((row) => visitSchema.parse(row));
      if (input.copyMaster && visits.some((visit) => visit.assigned_master_id && !visit.master_active)) {
        throw new OrderCopySelectionError("Один из мастеров выбранных выездов уже неактивен. Скопируйте выезды без мастеров.");
      }

      const masterRows = input.copyMaster && source.assigned_master_id
        ? await transaction`SELECT id, full_name, phone FROM masters
            WHERE organization_id = ${member.organizationId} AND id = ${source.assigned_master_id} AND active AND operational_status = 'working'`
        : [];
      if (input.copyMaster && source.assigned_master_id && !masterRows.length) throw new OrderReferenceError("master");
      const master = masterRows[0] ?? null;
      const agreedTotalMinor = services.reduce((sum, service) => sum + BigInt(service.line_total_minor), 0n);

      const [counter] = await transaction`INSERT INTO organization_order_counters (organization_id, next_order_number)
        VALUES (${member.organizationId}, 1002)
        ON CONFLICT (organization_id) DO UPDATE
          SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
        RETURNING next_order_number - 1 AS allocated_number`;
      const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
      const [createdOrder] = await transaction`INSERT INTO orders (
        organization_id, client_id, object_id, client_contact_id, order_number, status, currency,
        agreed_total_minor, assigned_master_id, master_payment_snapshot_minor,
        client_name_snapshot, object_name_snapshot, object_address_snapshot,
        contact_name_snapshot, contact_phone_snapshot, master_name_snapshot, master_phone_snapshot,
        notes, created_by
      ) VALUES (
        ${member.organizationId}, ${source.client_id}, ${source.object_id}, ${source.client_contact_id}, ${orderNumber}, 'new', 'RUB',
        ${agreedTotalMinor.toString()}, ${input.copyMaster ? source.assigned_master_id : null},
        ${input.copyMaster && source.master_payment_snapshot_minor !== null ? String(source.master_payment_snapshot_minor) : null},
        ${source.client_name}, ${source.object_name}, ${source.object_address}, ${source.contact_name}, ${source.contact_phone},
        ${input.copyMaster ? master?.full_name ?? null : null}, ${input.copyMaster ? master?.phone ?? null : null},
        ${input.copyNotes ? source.notes : null}, ${member.memberId}
      ) RETURNING id`;
      const orderId = uuidSchema.parse(createdOrder.id);

      for (const [index, service] of services.entries()) {
        await transaction`INSERT INTO order_services (
          organization_id, order_id, service_name_snapshot, quantity, unit_price_minor, line_total_minor, position, note
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${service.service_name_snapshot}, ${service.quantity},
          ${service.unit_price_minor}, ${service.line_total_minor}, ${index + 1}, ${service.note}
        )`;
      }
      for (const expense of expenses) {
        await transaction`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
          VALUES (${member.organizationId}, ${orderId}, ${expense.category}, ${expense.amount_minor}, ${input.copyDate}, ${expense.note}, ${member.memberId})`;
      }

      const earliestVisitDate = visits[0]?.local_date ?? null;
      for (const visit of visits) {
        const offsetDays = dayDifference(input.copyDate, earliestVisitDate!);
        const [range] = await transaction`SELECT
          (((${visit.scheduled_start_at.toISOString()}::timestamptz AT TIME ZONE ${organizationTimezone}) + make_interval(days => ${offsetDays})) AT TIME ZONE ${organizationTimezone}) AS start_at,
          (((${visit.scheduled_end_at.toISOString()}::timestamptz AT TIME ZONE ${organizationTimezone}) + make_interval(days => ${offsetDays})) AT TIME ZONE ${organizationTimezone}) AS end_at`;
        const startAt = z.coerce.date().parse(range.start_at);
        const endAt = z.coerce.date().parse(range.end_at);
        const assignedMasterId = input.copyMaster ? visit.assigned_master_id : null;
        if (assignedMasterId) {
          const conflicts = await transaction`SELECT id FROM service_visits
            WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${assignedMasterId}
              AND status <> 'cancelled' AND scheduled_start_at < ${endAt} AND scheduled_end_at > ${startAt}
            LIMIT 1`;
          if (conflicts.length) throw new OrderCopyScheduleConflictError();
        }
        const [createdVisit] = await transaction`INSERT INTO service_visits (
          organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, status,
          client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot,
          notes, created_by, updated_by
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${source.object_id}, ${assignedMasterId}, ${startAt}, ${endAt}, 'planned',
          ${source.client_name}, ${source.object_name}, ${source.object_address},
          ${input.copyMaster ? visit.master_name : null}, ${input.copyMaster ? visit.master_phone : null},
          ${visit.notes}, ${member.memberId}, ${member.memberId}
        ) RETURNING id`;
        const visitId = uuidSchema.parse(createdVisit.id);
        const afterState = {
          sourceVisitId: visit.id,
          scheduledStartAt: startAt.toISOString(),
          scheduledEndAt: endAt.toISOString(),
          status: "planned",
          assignedMasterId,
          notes: visit.notes,
        };
        await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
          VALUES (${member.organizationId}, ${visitId}, ${member.memberId}, 'created', ${transaction.json(afterState)})`;
        await transaction`INSERT INTO tasks (
          organization_id, title, description, priority, due_at, assigned_member_id, related_order_id, related_visit_id,
          source, reminder_kind, created_by, updated_by
        ) VALUES (
          ${member.organizationId}, ${`Подготовить выезд ${orderNumber}`}, 'Автоматическое напоминание по дате выезда.', 'high',
          ${startAt} - interval '1 day', ${member.memberId}, ${orderId}, ${visitId},
          'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
        )`;
      }

      const [sourceMembership] = await transaction`SELECT group_id FROM order_group_members
        WHERE organization_id = ${member.organizationId} AND order_id = ${source.id} FOR UPDATE`;
      let groupId: string;
      if (sourceMembership) {
        groupId = uuidSchema.parse(sourceMembership.group_id);
      } else {
        const [group] = await transaction`INSERT INTO order_groups (organization_id, client_id, created_by)
          VALUES (${member.organizationId}, ${source.client_id}, ${member.memberId}) RETURNING id`;
        groupId = uuidSchema.parse(group.id);
        await transaction`INSERT INTO order_group_members (organization_id, group_id, client_id, order_id, created_by)
          VALUES (${member.organizationId}, ${groupId}, ${source.client_id}, ${source.id}, ${member.memberId})`;
      }
      await transaction`INSERT INTO order_group_members (organization_id, group_id, client_id, order_id, created_by)
        VALUES (${member.organizationId}, ${groupId}, ${source.client_id}, ${orderId}, ${member.memberId})`;
      await transaction`UPDATE order_groups SET updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${groupId}`;

      await transaction`UPDATE idempotency_requests SET entity_id = ${orderId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.copy', 'order', ${orderId},
          ${transaction.json({ sourceOrderId: source.id, orderNumber, serviceCount: services.length, expenseCount: expenses.length, visitCount: visits.length, copyMaster: input.copyMaster, copyNotes: input.copyNotes, copyDate: input.copyDate, groupId })})`;
      return orderId;
    });
  } catch (error) {
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new OrderCopyScheduleConflictError();
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new OrderCopyScheduleConflictError();
    throw error;
  }
}
