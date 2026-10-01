import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import { publishOrderCreated } from "@/server/domain-events/order-created";
import { calculateServiceLineTotalMinor, formatQuantityForDatabase, parseMoneyToMinorUnits, parseQuantityToMilliunits } from "./money";
import type { CopyOrderInput } from "./schemas";
import { OrderNotFoundError, OrderReferenceError, OrderVersionConflictError } from "./repository";

const uuidSchema = z.string().uuid();
const sourceOrderSchema = z.object({
  id: uuidSchema,
  client_id: uuidSchema,
  object_id: uuidSchema.nullable(),
  client_contact_id: uuidSchema.nullable(),
  assigned_master_id: uuidSchema.nullable(),
  master_payment_snapshot_minor: z.union([z.string(), z.bigint(), z.number()]).nullable(),
  notes: z.string().nullable(),
  price_pending: z.boolean(),
  version: z.number().int().positive(),
  client_name: z.string(),
  object_name: z.string(),
  object_address: z.string(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
});
const serviceSchema = z.object({
  id: uuidSchema,
  catalog_item_id: uuidSchema.nullable(),
  item_kind_snapshot: z.enum(["service", "product"]),
  unit_snapshot: z.string(),
  service_name_snapshot: z.string(),
  quantity: z.string(),
  unit_price_minor: z.union([z.string(), z.bigint(), z.number()]).transform(String),
  line_total_minor: z.union([z.string(), z.bigint(), z.number()]).transform(String),
  price_pending: z.boolean(),
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
  arrival_mode: z.enum(["fixed", "window"]),
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
  if (input.visitIds.length || input.dateOverrides.some((override) => override.startTime)) requirePermission(member, "visits.write");
  const canWriteFinance = hasPermission(member, "finance.write");
  if (!canWriteFinance && (input.expenseIds.length || input.dateOverrides.some((override) => override.expenseIds?.length || override.masterPayment !== undefined))) {
    requirePermission(member, "finance.write");
  }
  const sql = getDatabase();
  const copyDates = input.copyDates.length ? [...input.copyDates].sort() : [input.copyDate];

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
        orders.assigned_master_id, orders.master_payment_snapshot_minor, orders.notes, orders.price_pending, orders.version,
        clients.legal_name AS client_name, coalesce(client_objects.name, orders.object_name_snapshot) AS object_name,
        coalesce(client_objects.address, orders.object_address_snapshot) AS object_address,
        client_contacts.full_name AS contact_name, client_contacts.phone AS contact_phone
        FROM orders
        JOIN clients ON clients.organization_id = orders.organization_id AND clients.id = orders.client_id
        LEFT JOIN client_objects ON client_objects.organization_id = orders.organization_id AND client_objects.id = orders.object_id
        LEFT JOIN client_contacts ON client_contacts.organization_id = orders.organization_id AND client_contacts.id = orders.client_contact_id
        WHERE orders.organization_id = ${member.organizationId} AND orders.id = ${input.sourceOrderId}
        FOR UPDATE OF orders`;
      if (!sourceRow) throw new OrderNotFoundError();
      const source = sourceOrderSchema.parse(sourceRow);
      if (source.version !== input.expectedVersion) throw new OrderVersionConflictError();
      const linkedContacts = await transaction`SELECT contact_id FROM order_contacts
        WHERE organization_id = ${member.organizationId} AND order_id = ${source.id} ORDER BY position`;
      const linkedObjects = await transaction`SELECT object_id FROM order_objects
        WHERE organization_id = ${member.organizationId} AND order_id = ${source.id} ORDER BY position`;

      const serviceRows = await transaction`SELECT id, catalog_item_id, item_kind_snapshot, unit_snapshot, service_name_snapshot, quantity::text, unit_price_minor, line_total_minor, price_pending, note
        FROM order_services
        WHERE organization_id = ${member.organizationId} AND order_id = ${source.id}
        ORDER BY position`;
      const sourceServices = serviceRows.map((row) => serviceSchema.parse(row));
      const sourceServiceIds = new Set(sourceServices.map((service) => service.id));
      if ([...input.serviceIds, ...input.dateOverrides.flatMap((item) => [...(item.serviceIds ?? []), ...(item.serviceChanges ?? []).map((change) => change.id)])].some((id) => !sourceServiceIds.has(id))) {
        throw new OrderCopySelectionError("Одна из выбранных услуг больше не относится к этому заказу.");
      }
      const addedCatalogIds = [...new Set(input.dateOverrides.flatMap((item) => (item.extraServices ?? []).flatMap((service) => service.catalogItemId ? [service.catalogItemId] : [])))];
      if (addedCatalogIds.length) {
        const catalogRows = await transaction`SELECT items.id, items.kind, items.unit, items.name
          FROM catalog_items items
          WHERE items.organization_id = ${member.organizationId} AND items.active
            AND items.id IN ${transaction(addedCatalogIds)}`;
        const catalogItems = new Map<string, { kind: "service" | "product"; unit: string; names: Set<string> }>();
        for (const row of catalogRows) {
          const id = uuidSchema.parse(row.id);
          const item = catalogItems.get(id) ?? {
            kind: z.enum(["service", "product"]).parse(row.kind),
            unit: z.string().parse(row.unit),
            names: new Set<string>(),
          };
          item.names.add(z.string().parse(row.name));
          catalogItems.set(id, item);
        }
        if (input.dateOverrides.some((item) => (item.extraServices ?? []).some((service) => {
          if (!service.catalogItemId) return false;
          const catalogItem = catalogItems.get(service.catalogItemId);
          return !catalogItem || catalogItem.kind !== service.kind || catalogItem.unit !== service.unit || !catalogItem.names.has(service.name);
        }))) {
          throw new OrderCopySelectionError("Добавленная услуга больше не доступна в справочнике.");
        }
      }

      const expenseRows = await transaction`SELECT id, category, amount_minor, note FROM order_expenses
            WHERE organization_id = ${member.organizationId} AND order_id = ${source.id}
            ORDER BY occurred_on, created_at`;
      const sourceExpenseIds = new Set(expenseRows.map((row) => uuidSchema.parse(row.id)));
      if ([...input.expenseIds, ...input.dateOverrides.flatMap((item) => item.expenseIds ?? [])].some((id) => !sourceExpenseIds.has(id))) {
        throw new OrderCopySelectionError("Один из выбранных расходов больше не относится к этому заказу.");
      }
      const sourceExpenses = expenseRows.map((row) => expenseSchema.parse(row));

      const [organization] = await transaction`SELECT timezone, (now() AT TIME ZONE timezone)::date::text AS today
        FROM organizations WHERE id = ${member.organizationId}`;
      const organizationTimezone = z.string().parse(organization?.timezone);
      const today = z.string().parse(organization?.today);
      if (input.visitIds.length && copyDates.some((date) => date < today)) {
        throw new OrderCopySelectionError("Будущие выезды нельзя переносить на прошедшую дату.");
      }

      const visitRows = input.visitIds.length
        ? await transaction`SELECT service_visits.id, service_visits.scheduled_start_at, service_visits.scheduled_end_at,
            (service_visits.scheduled_start_at AT TIME ZONE ${organizationTimezone})::date::text AS local_date,
            service_visits.assigned_master_id, masters.full_name AS master_name, masters.phone AS master_phone,
            masters.active AS master_active, service_visits.notes, service_visits.arrival_mode
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
      if (!source.object_id && input.dateOverrides.some((override) => override.startTime && !visits.length)) {
        throw new OrderCopySelectionError("Перед созданием выезда добавьте объект в исходный заказ.");
      }
      if (input.copyMaster && visits.some((visit) => visit.assigned_master_id && !visit.master_active)) {
        throw new OrderCopySelectionError("Один из мастеров выбранных выездов уже неактивен. Скопируйте выезды без мастеров.");
      }

      const masterRows = input.copyMaster && source.assigned_master_id
        ? await transaction`SELECT id, full_name, phone FROM masters
            WHERE organization_id = ${member.organizationId} AND id = ${source.assigned_master_id} AND active AND operational_status = 'working'`
        : [];
      if (input.copyMaster && source.assigned_master_id && !masterRows.length) throw new OrderReferenceError("master");
      const master = masterRows[0] ?? null;
      const overrideMasterIds = [...new Set(input.dateOverrides.map((override) => override.assignedMasterId).filter((id): id is string => Boolean(id)))];
      const overrideMasterRows = overrideMasterIds.length ? await transaction`SELECT id, full_name, phone FROM masters
        WHERE organization_id = ${member.organizationId} AND id = ANY(${overrideMasterIds}::uuid[]) AND active AND operational_status = 'working'` : [];
      if (overrideMasterRows.length !== overrideMasterIds.length) throw new OrderReferenceError("master");
      const overrideMasters = new Map(overrideMasterRows.map((row) => [uuidSchema.parse(row.id), row]));

      const createdOrderIds: string[] = [];
      for (const copyDate of copyDates) {
      const override = input.dateOverrides.find((item) => item.date === copyDate);
      const selectedServiceIds = new Set(override?.serviceIds ?? input.serviceIds);
      const services = sourceServices.filter((service) => selectedServiceIds.has(service.id)).map((service) => {
        const change = override?.serviceChanges?.find((item) => item.id === service.id);
        if (!change) return service;
        const quantity = parseQuantityToMilliunits(change.quantity);
        const pricePending = change.unitPrice === "";
        const unitPrice = pricePending ? 0n : parseMoneyToMinorUnits(change.unitPrice);
        return { ...service, quantity: formatQuantityForDatabase(quantity), price_pending: pricePending,
          unit_price_minor: unitPrice.toString(), line_total_minor: calculateServiceLineTotalMinor(unitPrice, quantity).toString() };
      });
      const selectedExpenseIds = new Set(override?.expenseIds ?? input.expenseIds);
      const expenses = sourceExpenses.filter((expense) => selectedExpenseIds.has(expense.id));
      const extraServices = (override?.extraServices ?? []).map((service) => {
        const quantity = parseQuantityToMilliunits(String(service.quantity));
        const pricePending = !service.unitPrice;
        const unitPrice = pricePending ? 0n : parseMoneyToMinorUnits(service.unitPrice);
        return { ...service, pricePending, quantity: formatQuantityForDatabase(quantity), unitPriceMinor: unitPrice.toString(), lineTotalMinor: calculateServiceLineTotalMinor(unitPrice, quantity).toString() };
      });
      const agreedTotalMinor = services.reduce((sum, service) => sum + BigInt(service.line_total_minor), 0n)
        + extraServices.reduce((sum, service) => sum + BigInt(service.lineTotalMinor), 0n);
      const assignedOrderMasterId = override?.assignedMasterId !== undefined ? override.assignedMasterId : input.copyMaster ? source.assigned_master_id : null;
      const assignedOrderMaster = assignedOrderMasterId ? overrideMasters.get(assignedOrderMasterId) ?? master : null;
      const masterPaymentMinor = assignedOrderMasterId && canWriteFinance ? override?.masterPayment !== undefined
        ? override.masterPayment === null ? null : parseMoneyToMinorUnits(override.masterPayment).toString()
        : assignedOrderMasterId === source.assigned_master_id && input.copyMaster && source.master_payment_snapshot_minor !== null
          ? String(source.master_payment_snapshot_minor) : null : null;
      const orderNotes = override?.notes !== undefined ? override.notes : input.copyNotes ? source.notes : null;

      const [counter] = await transaction`INSERT INTO organization_order_counters (organization_id, next_order_number)
        VALUES (${member.organizationId}, 1002)
        ON CONFLICT (organization_id) DO UPDATE
          SET next_order_number = organization_order_counters.next_order_number + 1, updated_at = now()
        RETURNING next_order_number - 1 AS allocated_number`;
      const orderNumber = `№${z.coerce.string().parse(counter.allocated_number)}`;
      const [createdOrder] = await transaction`INSERT INTO orders (
        organization_id, client_id, object_id, client_contact_id, order_number, status, currency, price_pending,
        agreed_total_minor, assigned_master_id, master_payment_snapshot_minor,
        client_name_snapshot, object_name_snapshot, object_address_snapshot,
        contact_name_snapshot, contact_phone_snapshot, master_name_snapshot, master_phone_snapshot,
        notes, created_by
      ) VALUES (
        ${member.organizationId}, ${source.client_id}, ${source.object_id}, ${input.copyContact ? source.client_contact_id : null}, ${orderNumber}, ${visits.length || override?.startTime ? "scheduled" : "new"}, 'RUB', ${services.length + extraServices.length === 0 || services.some((service) => service.price_pending) || extraServices.some((service) => service.pricePending)},
        ${agreedTotalMinor.toString()}, ${assignedOrderMasterId},
        ${masterPaymentMinor},
        ${source.client_name}, ${source.object_name}, ${source.object_address}, ${input.copyContact ? source.contact_name : null}, ${input.copyContact ? source.contact_phone : null},
        ${assignedOrderMaster?.full_name ?? null}, ${assignedOrderMaster?.phone ?? null},
        ${orderNotes}, ${member.memberId}
      ) RETURNING id`;
      const orderId = uuidSchema.parse(createdOrder.id);

      const contactIds = input.copyContact
        ? linkedContacts.length ? linkedContacts.map((row) => uuidSchema.parse(row.contact_id)) : source.client_contact_id ? [source.client_contact_id] : []
        : [];
      for (const [index, contactId] of contactIds.entries()) await transaction`INSERT INTO order_contacts
        (organization_id, order_id, contact_id, position) VALUES (${member.organizationId}, ${orderId}, ${contactId}, ${index + 1})`;
      const objectIds = input.copyRelatedObjects && linkedObjects.length
        ? linkedObjects.map((row) => uuidSchema.parse(row.object_id)) : source.object_id ? [source.object_id] : [];
      for (const [index, objectId] of objectIds.entries()) await transaction`INSERT INTO order_objects
        (organization_id, order_id, object_id, position) VALUES (${member.organizationId}, ${orderId}, ${objectId}, ${index + 1})`;

      for (const [index, service] of services.entries()) {
        await transaction`INSERT INTO order_services (
          organization_id, order_id, catalog_item_id, item_kind_snapshot, unit_snapshot, service_name_snapshot, quantity, unit_price_minor, line_total_minor, price_pending, position, note
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${service.catalog_item_id}, ${service.item_kind_snapshot}, ${service.unit_snapshot}, ${service.service_name_snapshot}, ${service.quantity},
          ${service.unit_price_minor}, ${service.line_total_minor}, ${service.price_pending}, ${index + 1}, ${service.note}
        )`;
      }
      for (const [index, service] of extraServices.entries()) {
        await transaction`INSERT INTO order_services (
          organization_id, order_id, catalog_item_id, item_kind_snapshot, unit_snapshot, service_name_snapshot, quantity, unit_price_minor, line_total_minor, price_pending, position, note
        ) VALUES (${member.organizationId}, ${orderId}, ${service.catalogItemId ?? null}, ${service.kind}, ${service.unit}, ${service.name}, ${service.quantity}, ${service.unitPriceMinor}, ${service.lineTotalMinor}, ${service.pricePending}, ${services.length + index + 1}, NULL)`;
      }
      for (const expense of expenses) {
        await transaction`INSERT INTO order_expenses (organization_id, order_id, category, amount_minor, occurred_on, note, created_by)
          VALUES (${member.organizationId}, ${orderId}, ${expense.category}, ${expense.amount_minor}, ${copyDate}, ${expense.note}, ${member.memberId})`;
      }

      const earliestVisitDate = visits[0]?.local_date ?? null;
      const visitsForCopy = visits.length ? visits : override?.startTime ? [null] : [];
      for (const [visitIndex, visit] of visitsForCopy.entries()) {
        let startAt: Date;
        let endAt: Date;
        if (visit) {
          const offsetDays = dayDifference(copyDate, earliestVisitDate!);
          const [range] = await transaction`SELECT
            (((${visit.scheduled_start_at.toISOString()}::timestamptz AT TIME ZONE ${organizationTimezone}) + make_interval(days => ${offsetDays})) AT TIME ZONE ${organizationTimezone}) AS start_at,
            (((${visit.scheduled_end_at.toISOString()}::timestamptz AT TIME ZONE ${organizationTimezone}) + make_interval(days => ${offsetDays})) AT TIME ZONE ${organizationTimezone}) AS end_at`;
          startAt = z.coerce.date().parse(range.start_at);
          endAt = z.coerce.date().parse(range.end_at);
        } else {
          startAt = new Date(0);
          endAt = new Date(0);
        }
        if (visitIndex === 0 && override?.startTime) {
          const endTime = override.arrivalMode === "fixed" ? override.startTime : override.endTime!;
          const [window] = await transaction`SELECT
            ((${copyDate} || ' ' || ${override.startTime})::timestamp AT TIME ZONE ${organizationTimezone}) AS start_at,
            (((${copyDate} || ' ' || ${endTime})::timestamp
              + CASE WHEN ${override.arrivalMode === "fixed"} THEN interval '2 hours'
                WHEN ${endTime}::time < ${override.startTime}::time THEN interval '1 day' ELSE interval '0 day' END)
              AT TIME ZONE ${organizationTimezone}) AS end_at`;
          startAt = z.coerce.date().parse(window.start_at);
          endAt = z.coerce.date().parse(window.end_at);
          if (endAt.getTime() - startAt.getTime() < 15 * 60_000) throw new OrderCopySelectionError("Интервал выезда должен длиться не менее 15 минут.");
        }
        const arrivalMode = visitIndex === 0 && override?.arrivalMode ? override.arrivalMode : visit?.arrival_mode ?? "window";
        const assignedMasterId = override?.assignedMasterId !== undefined ? override.assignedMasterId : input.copyMaster ? visit?.assigned_master_id ?? null : null;
        const visitMaster = assignedMasterId ? overrideMasters.get(assignedMasterId) ?? (assignedMasterId === visit?.assigned_master_id ? { full_name: visit?.master_name ?? null, phone: visit?.master_phone ?? null } : master) : null;
        if (assignedMasterId) {
          const conflicts = await transaction`SELECT id FROM service_visits
            WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${assignedMasterId}
              AND status <> 'cancelled' AND scheduled_start_at < ${endAt} AND scheduled_end_at > ${startAt}
            LIMIT 1`;
          if (conflicts.length) throw new OrderCopyScheduleConflictError();
        }
        const [createdVisit] = await transaction`INSERT INTO service_visits (
          organization_id, order_id, object_id, assigned_master_id, scheduled_start_at, scheduled_end_at, arrival_mode, status,
          client_name_snapshot, object_name_snapshot, object_address_snapshot, master_name_snapshot, master_phone_snapshot,
          notes, created_by, updated_by
        ) VALUES (
          ${member.organizationId}, ${orderId}, ${source.object_id}, ${assignedMasterId}, ${startAt}, ${endAt}, ${arrivalMode}, 'planned',
          ${source.client_name}, ${source.object_name}, ${source.object_address},
          ${visitMaster?.full_name ?? null}, ${visitMaster?.phone ?? null},
          ${override?.visitNotes !== undefined ? override.visitNotes : visit?.notes ?? null}, ${member.memberId}, ${member.memberId}
        ) RETURNING id`;
        const visitId = uuidSchema.parse(createdVisit.id);
        const afterState = {
          sourceVisitId: visit?.id ?? null,
          scheduledStartAt: startAt.toISOString(),
          scheduledEndAt: endAt.toISOString(),
          status: "planned",
          assignedMasterId,
          arrivalMode,
          notes: override?.visitNotes !== undefined ? override.visitNotes : visit?.notes ?? null,
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

      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'order.copy', 'order', ${orderId},
          ${transaction.json({ sourceOrderId: source.id, orderNumber, serviceCount: services.length + extraServices.length, expenseCount: expenses.length, visitCount: visits.length, copyContact: input.copyContact, copyRelatedObjects: input.copyRelatedObjects, assignedMasterId: assignedOrderMasterId, copyNotes: input.copyNotes, dateOverride: override ?? null, copyDate, seriesSize: copyDates.length, groupId })})`;
      await publishOrderCreated(transaction, member.organizationId, orderId);
      createdOrderIds.push(orderId);
      }
      await transaction`UPDATE idempotency_requests SET entity_id = ${createdOrderIds[0]}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      return createdOrderIds[0];
    });
  } catch (error) {
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new OrderCopyScheduleConflictError();
    if (databaseConstraint(error, "23505") === "service_visits_order_start_unique_idx") throw new OrderCopyScheduleConflictError();
    throw error;
  }
}
