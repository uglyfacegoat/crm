import "server-only";
import { MASTER_PAGE_SIZE, masterListQuerySchema, type MasterListPage, type MasterListQuery } from "@/lib/master-list";
import { readableOrganizationIds } from "@/server/organizations/read-scope";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import { minorUnitsToSafeNumber } from "@/server/orders/money";
import type { CreateMasterInput, UpdateMasterInput } from "./schemas";
import { getMasterStatus } from "./status";
import { visitStatusLabels } from "@/server/visits/types";
import { masterOperationalStatuses, type MasterDetail, type MasterListItem, type MasterVisitSummary } from "./types";

const masterRowSchema = z.object({
  organization_id: z.string().uuid().optional(), organization_name: z.string().optional(), organization_timezone: z.string().optional(),
  today_visit_count: z.number().int().nonnegative().optional(),
  id: z.string().uuid(),
  full_name: z.string(),
  phone: z.string(),
  messenger: z.string().nullable(),
  service_region: z.string(),
  service_zone: z.string(),
  base_payment_minor: z.union([z.string(), z.number(), z.bigint()]).nullable(),
  daily_capacity: z.number().int().positive(),
  skills: z.array(z.string()),
  notes: z.string().nullable(),
  operational_status: z.enum(masterOperationalStatuses),
  working_days: z.array(z.number().int().min(1).max(7)),
  status_until: z.coerce.date().nullable(),
  status_note: z.string().nullable(),
  active: z.boolean(),
  version: z.number().int().positive(),
});

const visitRowSchema = z.object({
  id: z.string().uuid(),
  assigned_master_id: z.string().uuid(),
  order_id: z.string().uuid().nullable(),
  contract_id: z.string().uuid().nullable().optional(),
  order_number: z.union([z.string(), z.number(), z.bigint()]).nullable(),
  client_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  scheduled_start_at: z.coerce.date(),
  timezone: z.string(),
});
const detailVisitRowSchema = visitRowSchema.omit({ assigned_master_id: true }).extend({
  object_name_snapshot: z.string(),
  status: z.enum(["planned", "confirmed", "in_progress", "completed", "cancelled"]),
});
const masterStatsRowSchema = z.object({
  total_visits: z.coerce.number().int().nonnegative(),
  completed_visits: z.coerce.number().int().nonnegative(),
  upcoming_visits: z.coerce.number().int().nonnegative(),
  total_orders: z.coerce.number().int().nonnegative(),
});
const masterEarningsRowSchema = z.object({ accrued_minor: z.union([z.string(), z.number(), z.bigint()]), paid_minor: z.union([z.string(), z.number(), z.bigint()]) });

export class MasterConflictError extends Error {
  constructor() { super("A master with this phone already exists."); this.name = "MasterConflictError"; }
}
export class MasterNotFoundError extends Error {
  constructor() { super("Master was not found."); this.name = "MasterNotFoundError"; }
}
export class MasterVersionConflictError extends Error {
  constructor() { super("Master was changed by another member."); this.name = "MasterVersionConflictError"; }
}
export class MasterHasFutureVisitsError extends Error {
  constructor() { super("Master has future service visits."); this.name = "MasterHasFutureVisitsError"; }
}

function databaseConstraint(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function groupVisits(rows: unknown[]) {
  const grouped = new Map<string, MasterVisitSummary[]>();
  for (const row of rows) {
    const visit = visitRowSchema.parse(row);
    const entries = grouped.get(visit.assigned_master_id) ?? [];
    entries.push({
      id: visit.id,
      orderId: visit.order_id,
      orderNumber: visit.order_number === null ? null : String(visit.order_number),
      contractId: visit.contract_id ?? null,
      clientName: visit.client_name_snapshot,
      objectAddress: visit.object_address_snapshot,
      scheduledStartAt: visit.scheduled_start_at.toISOString(),
      timezone: visit.timezone,
    });
    grouped.set(visit.assigned_master_id, entries);
  }
  return grouped;
}

function mapMasterListRows(member: AuthenticatedMember, masterRows: unknown[], visitRows: unknown[]): MasterListItem[] {
  const visitsByMaster = groupVisits(visitRows);
  const canReadFinance = hasPermission(member, "finance.read");
  return masterRows.map((row) => {
    const master = masterRowSchema.parse(row);
    const todayVisits = visitsByMaster.get(master.id) ?? [];
    const status = getMasterStatus(master.operational_status, (master.today_visit_count ?? todayVisits.length), master.daily_capacity);
    return {
      id: master.id,
      organizationId: master.organization_id, organizationName: master.organization_name, organizationTimezone: master.organization_timezone,
      fullName: master.full_name,
      phone: master.phone,
      messenger: master.messenger,
      serviceRegion: master.service_region,
      serviceZone: master.service_zone,
      ...(canReadFinance ? { basePaymentMinor: master.base_payment_minor === null ? null : minorUnitsToSafeNumber(master.base_payment_minor) } : {}),
      dailyCapacity: master.daily_capacity,
      skills: master.skills,
      notes: master.notes,
      operationalStatus: master.operational_status,
      workingDays: master.working_days,
      statusUntil: master.status_until?.toISOString().slice(0, 10) ?? null,
      statusNote: master.status_note,
      active: master.active,
      version: master.version,
      todayVisitCount: master.today_visit_count ?? todayVisits.length,
      loadPercent: Math.round(((master.today_visit_count ?? todayVisits.length) / master.daily_capacity) * 100),
      statusCode: status.code,
      statusLabel: status.label,
      todayVisits,
    };
  });
}

export async function listMasterPage(member: AuthenticatedMember, input: MasterListQuery): Promise<MasterListPage> {
  requirePermission(member, "masters.read");
  const query = masterListQuerySchema.parse(input);
  const sql = getDatabase();
  const organizationIds = await readableOrganizationIds(member);
  const [result] = await sql`WITH today AS (
    SELECT service_visits.organization_id, assigned_master_id, count(*)::int AS today_visit_count FROM service_visits
    JOIN organizations ON organizations.id = service_visits.organization_id
    WHERE service_visits.organization_id IN ${sql(organizationIds)} AND assigned_master_id IS NOT NULL
      AND status NOT IN ('cancelled', 'completed')
      AND (scheduled_start_at AT TIME ZONE organizations.timezone)::date = (now() AT TIME ZONE organizations.timezone)::date
    GROUP BY service_visits.organization_id, assigned_master_id
  ), base AS (
    SELECT masters.*, organizations.name AS organization_name, organizations.timezone AS organization_timezone,
      coalesce(today.today_visit_count, 0) AS today_visit_count,
      CASE WHEN masters.operational_status <> 'working' THEN masters.operational_status
        WHEN coalesce(today.today_visit_count, 0) > masters.daily_capacity THEN 'overloaded'
        WHEN coalesce(today.today_visit_count, 0) > 0 THEN 'scheduled' ELSE 'available' END AS status_code
    FROM masters JOIN organizations ON organizations.id = masters.organization_id
    LEFT JOIN today ON today.organization_id = masters.organization_id AND today.assigned_master_id = masters.id
    WHERE masters.organization_id IN ${sql(organizationIds)}
  ), filtered AS (
    SELECT * FROM base WHERE (${query.q} = '' OR crm_search_matches(concat_ws(' ', full_name, phone, normalized_phone,
      messenger, service_region, service_zone, organization_name, array_to_string(skills, ' ')), ${query.q}))
      AND (${query.status} = 'all' OR status_code = ${query.status})
      AND (${query.region} = '' OR service_region = ${query.region})
      AND (${query.zone} = '' OR service_zone = ${query.zone})
      AND (${query.skill} = '' OR ${query.skill} = ANY(skills))
  ), totals AS (SELECT count(*)::int total FROM filtered), paging AS (
    SELECT total, least(${query.page}, greatest(1, ceil(total::numeric / ${MASTER_PAGE_SIZE})::int)) AS page FROM totals
  ), selected AS (
    SELECT * FROM filtered ORDER BY active DESC, full_name, id
    LIMIT ${MASTER_PAGE_SIZE} OFFSET (SELECT (page - 1) * ${MASTER_PAGE_SIZE} FROM paging)
  ) SELECT paging.total, paging.page, coalesce((SELECT jsonb_agg(to_jsonb(selected) ORDER BY selected.active DESC, selected.full_name, selected.id) FROM selected), '[]'::jsonb) AS items,
    (SELECT coalesce(jsonb_object_agg(status_code, amount), '{}'::jsonb) || jsonb_build_object('all', (SELECT count(*)::int FROM base))
      FROM (SELECT status_code, count(*)::int amount FROM base GROUP BY status_code) counts) AS counts,
    jsonb_build_object('regions', ARRAY(SELECT DISTINCT service_region FROM base ORDER BY service_region),
      'zones', ARRAY(SELECT DISTINCT service_zone FROM base WHERE ${query.region} = '' OR service_region = ${query.region} ORDER BY service_zone),
      'skills', ARRAY(SELECT DISTINCT unnest(skills) AS skill FROM base ORDER BY skill)) AS facets FROM paging`;
  const parsed = z.object({ total: z.number().int(), page: z.number().int(), items: z.array(z.unknown()),
    counts: z.record(z.string(), z.number().int()), facets: z.object({ regions: z.array(z.string()), zones: z.array(z.string()), skills: z.array(z.string()) }) }).parse(result);
  const ids = parsed.items.map(item => masterRowSchema.parse(item).id);
  const visitRows = ids.length ? await sql`WITH routes AS (
    SELECT service_visits.id, service_visits.assigned_master_id, service_visits.order_id, service_visits.contract_id,
      orders.order_number, service_visits.client_name_snapshot, service_visits.object_address_snapshot,
      service_visits.scheduled_start_at, organizations.timezone,
      row_number() OVER (PARTITION BY service_visits.assigned_master_id ORDER BY service_visits.scheduled_start_at, service_visits.id) AS position
    FROM service_visits JOIN organizations ON organizations.id = service_visits.organization_id
    LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
    WHERE service_visits.organization_id IN ${sql(organizationIds)} AND service_visits.assigned_master_id IN ${sql(ids)}
      AND service_visits.status NOT IN ('cancelled', 'completed')
      AND (service_visits.scheduled_start_at AT TIME ZONE organizations.timezone)::date = (now() AT TIME ZONE organizations.timezone)::date
  ) SELECT * FROM routes WHERE position <= 2 ORDER BY scheduled_start_at, id` : [];
  return { ...parsed, items: mapMasterListRows(member, parsed.items, visitRows), pageSize: MASTER_PAGE_SIZE };
}

export async function listMasters(member: AuthenticatedMember): Promise<MasterListItem[]> {
  return (await listMasterPage(member, masterListQuerySchema.parse({}))).items;
}

export async function getMasterDetail(member: AuthenticatedMember, masterId: string): Promise<MasterDetail> {
  requirePermission(member, "masters.read");
  const parsedMasterId = z.string().uuid().parse(masterId);
  const sql = getDatabase();
  const organizationIds = await readableOrganizationIds(member);
  const canReadFinance = hasPermission(member, "finance.read");
  const [masterRows, todayVisitRows, recentVisitRows, statsRows, earningsRows] = await Promise.all([
    sql`SELECT masters.*, organizations.name AS organization_name, organizations.timezone AS organization_timezone
      FROM masters JOIN organizations ON organizations.id = masters.organization_id WHERE masters.organization_id IN ${sql(organizationIds)} AND masters.id = ${parsedMasterId}`,
    sql`SELECT service_visits.id, service_visits.assigned_master_id, service_visits.order_id, service_visits.contract_id,
      orders.order_number, service_visits.client_name_snapshot, service_visits.object_address_snapshot,
      service_visits.scheduled_start_at, organizations.timezone
      FROM service_visits
      JOIN organizations ON organizations.id = service_visits.organization_id
      LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
      WHERE service_visits.organization_id IN ${sql(organizationIds)}
        AND service_visits.assigned_master_id = ${parsedMasterId}
        AND service_visits.status NOT IN ('cancelled', 'completed')
        AND (service_visits.scheduled_start_at AT TIME ZONE organizations.timezone)::date = (now() AT TIME ZONE organizations.timezone)::date
      ORDER BY service_visits.scheduled_start_at`,
    sql`SELECT service_visits.id, service_visits.order_id, service_visits.contract_id, orders.order_number,
      service_visits.client_name_snapshot, service_visits.object_name_snapshot, service_visits.object_address_snapshot,
      service_visits.scheduled_start_at, organizations.timezone, service_visits.status
      FROM service_visits
      JOIN organizations ON organizations.id = service_visits.organization_id
      LEFT JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
      WHERE service_visits.organization_id IN ${sql(organizationIds)} AND service_visits.assigned_master_id = ${parsedMasterId}
      ORDER BY service_visits.scheduled_start_at DESC, service_visits.id DESC LIMIT 30`,
    sql`SELECT count(*)::integer AS total_visits,
      count(*) FILTER (WHERE status = 'completed')::integer AS completed_visits,
      count(*) FILTER (WHERE scheduled_start_at >= now() AND status NOT IN ('completed', 'cancelled'))::integer AS upcoming_visits,
      count(DISTINCT order_id)::integer AS total_orders
      FROM service_visits WHERE organization_id IN ${sql(organizationIds)} AND assigned_master_id = ${parsedMasterId}`,
    canReadFinance ? sql`SELECT coalesce(sum(master_payment_snapshot_minor), 0) AS accrued_minor,
      coalesce(sum(master_paid_total_minor), 0) AS paid_minor
      FROM orders WHERE organization_id IN ${sql(organizationIds)} AND assigned_master_id = ${parsedMasterId}` : Promise.resolve([]),
  ]);
  if (!masterRows.length) throw new MasterNotFoundError();
  const row = masterRowSchema.parse(masterRows[0]);
  const todayVisits = groupVisits(todayVisitRows).get(row.id) ?? [];
  const status = getMasterStatus(row.operational_status, todayVisits.length, row.daily_capacity);
  const stats = masterStatsRowSchema.parse(statsRows[0]);
  const earnings = canReadFinance ? masterEarningsRowSchema.parse(earningsRows[0]) : null;
  return {
    id: row.id,
    organizationId: row.organization_id, organizationName: row.organization_name, organizationTimezone: row.organization_timezone,
    fullName: row.full_name,
    phone: row.phone,
    messenger: row.messenger,
    serviceRegion: row.service_region,
    serviceZone: row.service_zone,
    ...(canReadFinance ? { basePaymentMinor: row.base_payment_minor === null ? null : minorUnitsToSafeNumber(row.base_payment_minor) } : {}),
    dailyCapacity: row.daily_capacity,
    skills: row.skills,
    notes: row.notes,
    operationalStatus: row.operational_status,
    workingDays: row.working_days,
    statusUntil: row.status_until?.toISOString().slice(0, 10) ?? null,
    statusNote: row.status_note,
    active: row.active,
    version: row.version,
    todayVisitCount: todayVisits.length,
    loadPercent: Math.round((todayVisits.length / row.daily_capacity) * 100),
    statusCode: status.code,
    statusLabel: status.label,
    todayVisits,
    totalVisits: stats.total_visits,
    completedVisits: stats.completed_visits,
    upcomingVisits: stats.upcoming_visits,
    totalOrders: stats.total_orders,
    ...(earnings ? { accruedMinor: minorUnitsToSafeNumber(earnings.accrued_minor), paidMinor: minorUnitsToSafeNumber(earnings.paid_minor) } : {}),
    recentVisits: recentVisitRows.map((value) => {
      const visit = detailVisitRowSchema.parse(value);
      return {
        id: visit.id,
        orderId: visit.order_id,
        orderNumber: visit.order_number === null ? null : String(visit.order_number),
        contractId: visit.contract_id ?? null,
        clientName: visit.client_name_snapshot,
        objectName: visit.object_name_snapshot,
        objectAddress: visit.object_address_snapshot,
        scheduledStartAt: visit.scheduled_start_at.toISOString(),
        timezone: visit.timezone,
        statusCode: visit.status,
        status: visitStatusLabels[visit.status],
      };
    }),
  };
}

export async function createMaster(member: AuthenticatedMember, input: CreateMasterInput) {
  requirePermission(member, "masters.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`
        INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'masters.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        RETURNING idempotency_key
      `;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "masters.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }

      const [master] = await transaction`INSERT INTO masters
        (organization_id, full_name, phone, normalized_phone, messenger, service_region, service_zone,
          base_payment_minor, daily_capacity, skills, notes, operational_status, working_days, status_until, status_note, active)
        VALUES (${member.organizationId}, ${input.fullName}, ${input.phone}, ${normalizeContactPhone(input.phone)},
          ${input.messenger}, ${input.serviceRegion}, ${input.serviceZone}, ${input.basePaymentMinor},
          ${input.dailyCapacity}, ${input.skills}, ${input.notes}, ${input.operationalStatus}, ${input.workingDays}, ${input.statusUntil}, ${input.statusNote}, true)
        RETURNING id`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${master.id}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'master.create', 'master', ${master.id},
          ${transaction.json({ fullName: input.fullName, serviceRegion: input.serviceRegion, serviceZone: input.serviceZone, basePaymentMinor: input.basePaymentMinor })})`;
      return z.string().uuid().parse(master.id);
    });
  } catch (error) {
    if (databaseConstraint(error) === "masters_organization_phone_unique_idx") throw new MasterConflictError();
    throw error;
  }
}

export async function updateMaster(member: AuthenticatedMember, input: UpdateMasterInput) {
  requirePermission(member, "masters.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [existing] = await transaction`SELECT full_name, phone, messenger, service_region, service_zone,
        base_payment_minor, daily_capacity, skills, notes, operational_status, working_days, status_until, status_note, active, version
        FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.masterId} FOR UPDATE`;
      if (!existing) throw new MasterNotFoundError();
      const current = masterRowSchema.omit({ id: true }).parse(existing);
      if (current.version !== input.expectedVersion) throw new MasterVersionConflictError();

      if (current.operational_status !== "terminated" && input.operationalStatus === "terminated") {
        const [futureVisit] = await transaction`SELECT id FROM service_visits
          WHERE organization_id = ${member.organizationId} AND assigned_master_id = ${input.masterId}
            AND scheduled_start_at > now() AND status NOT IN ('cancelled', 'completed')
          LIMIT 1`;
        if (futureVisit) throw new MasterHasFutureVisitsError();
      }

      const [updated] = await transaction`UPDATE masters SET
        full_name = ${input.fullName}, phone = ${input.phone}, normalized_phone = ${normalizeContactPhone(input.phone)},
        messenger = ${input.messenger}, service_region = ${input.serviceRegion}, service_zone = ${input.serviceZone},
        base_payment_minor = ${input.basePaymentMinor}, daily_capacity = ${input.dailyCapacity}, skills = ${input.skills},
        notes = ${input.notes}, operational_status = ${input.operationalStatus}, working_days = ${input.workingDays},
        status_until = ${input.statusUntil}, status_note = ${input.statusNote}, active = ${input.operationalStatus !== "terminated"}, version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.masterId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!updated) throw new MasterVersionConflictError();
      const nextVersion = z.number().int().positive().parse(updated.version);

      if (input.operationalStatus === "terminated") {
        const linkedMembers = await transaction`UPDATE organization_members
          SET active = false, version = version + 1, updated_at = now()
          WHERE organization_id = ${member.organizationId} AND master_id = ${input.masterId} AND active
          RETURNING id`;
        if (linkedMembers.length) {
          await transaction`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now())
            WHERE organization_id = ${member.organizationId}
              AND member_id = ANY(${linkedMembers.map((linkedMember) => linkedMember.id)}::uuid[])
              AND revoked_at IS NULL`;
        }
      }

      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'master.update', 'master', ${input.masterId},
          ${transaction.json({
            before: { fullName: current.full_name, serviceRegion: current.service_region, serviceZone: current.service_zone, basePaymentMinor: current.base_payment_minor === null ? null : minorUnitsToSafeNumber(current.base_payment_minor), operationalStatus: current.operational_status, workingDays: current.working_days },
            after: { fullName: input.fullName, serviceRegion: input.serviceRegion, serviceZone: input.serviceZone, basePaymentMinor: input.basePaymentMinor, operationalStatus: input.operationalStatus, workingDays: input.workingDays },
            version: nextVersion,
          })})`;
      return nextVersion;
    });
  } catch (error) {
    if (databaseConstraint(error) === "masters_organization_phone_unique_idx") throw new MasterConflictError();
    throw error;
  }
}
