import "server-only";
import { z } from "zod";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { normalizeContactPhone } from "@/server/clients/phone";
import { getDatabase } from "@/server/database";
import { minorUnitsToSafeNumber } from "@/server/orders/money";
import type { CreateMasterInput, UpdateMasterInput } from "./schemas";
import { getMasterStatus } from "./status";
import type { MasterListItem, MasterVisitSummary } from "./types";

const masterRowSchema = z.object({
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
  active: z.boolean(),
  version: z.number().int().positive(),
});

const visitRowSchema = z.object({
  id: z.string().uuid(),
  assigned_master_id: z.string().uuid(),
  order_id: z.string().uuid(),
  order_number: z.union([z.string(), z.number(), z.bigint()]),
  client_name_snapshot: z.string(),
  object_address_snapshot: z.string(),
  scheduled_start_at: z.coerce.date(),
  timezone: z.string(),
});

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
      orderNumber: String(visit.order_number),
      clientName: visit.client_name_snapshot,
      objectAddress: visit.object_address_snapshot,
      scheduledStartAt: visit.scheduled_start_at.toISOString(),
      timezone: visit.timezone,
    });
    grouped.set(visit.assigned_master_id, entries);
  }
  return grouped;
}

export async function listMasters(member: AuthenticatedMember): Promise<MasterListItem[]> {
  requirePermission(member, "masters.read");
  const sql = getDatabase();
  const [masterRows, visitRows] = await Promise.all([
    sql`SELECT id, full_name, phone, messenger, service_region, service_zone, base_payment_minor,
      daily_capacity, skills, notes, active, version
      FROM masters
      WHERE organization_id = ${member.organizationId}
      ORDER BY active DESC, full_name ASC
      LIMIT 500`,
    sql`SELECT service_visits.id, service_visits.assigned_master_id, service_visits.order_id,
      orders.order_number, service_visits.client_name_snapshot, service_visits.object_address_snapshot,
      service_visits.scheduled_start_at, organizations.timezone
      FROM service_visits
      JOIN organizations ON organizations.id = service_visits.organization_id
      JOIN orders ON orders.organization_id = service_visits.organization_id AND orders.id = service_visits.order_id
      WHERE service_visits.organization_id = ${member.organizationId}
        AND service_visits.assigned_master_id IS NOT NULL
        AND service_visits.status NOT IN ('cancelled', 'completed')
        AND (service_visits.scheduled_start_at AT TIME ZONE organizations.timezone)::date
          = (now() AT TIME ZONE organizations.timezone)::date
      ORDER BY service_visits.scheduled_start_at ASC`,
  ]);
  const visitsByMaster = groupVisits(visitRows);
  const canReadFinance = hasPermission(member.role, "finance.read");

  return masterRows.map((row) => {
    const master = masterRowSchema.parse(row);
    const todayVisits = visitsByMaster.get(master.id) ?? [];
    const status = getMasterStatus(master.active, todayVisits.length, master.daily_capacity);
    return {
      id: master.id,
      fullName: master.full_name,
      phone: master.phone,
      messenger: master.messenger,
      serviceRegion: master.service_region,
      serviceZone: master.service_zone,
      ...(canReadFinance ? { basePaymentMinor: master.base_payment_minor === null ? null : minorUnitsToSafeNumber(master.base_payment_minor) } : {}),
      dailyCapacity: master.daily_capacity,
      skills: master.skills,
      notes: master.notes,
      active: master.active,
      version: master.version,
      todayVisitCount: todayVisits.length,
      loadPercent: Math.round((todayVisits.length / master.daily_capacity) * 100),
      statusCode: status.code,
      statusLabel: status.label,
      todayVisits,
    };
  });
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
          base_payment_minor, daily_capacity, skills, notes)
        VALUES (${member.organizationId}, ${input.fullName}, ${input.phone}, ${normalizeContactPhone(input.phone)},
          ${input.messenger}, ${input.serviceRegion}, ${input.serviceZone}, ${input.basePaymentMinor},
          ${input.dailyCapacity}, ${input.skills}, ${input.notes})
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
        base_payment_minor, daily_capacity, skills, notes, active, version
        FROM masters WHERE organization_id = ${member.organizationId} AND id = ${input.masterId} FOR UPDATE`;
      if (!existing) throw new MasterNotFoundError();
      const current = masterRowSchema.omit({ id: true }).parse(existing);
      if (current.version !== input.expectedVersion) throw new MasterVersionConflictError();

      if (current.active && !input.active) {
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
        notes = ${input.notes}, active = ${input.active}, version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.masterId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!updated) throw new MasterVersionConflictError();
      const nextVersion = z.number().int().positive().parse(updated.version);

      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'master.update', 'master', ${input.masterId},
          ${transaction.json({
            before: { fullName: current.full_name, serviceRegion: current.service_region, serviceZone: current.service_zone, basePaymentMinor: current.base_payment_minor === null ? null : minorUnitsToSafeNumber(current.base_payment_minor), active: current.active },
            after: { fullName: input.fullName, serviceRegion: input.serviceRegion, serviceZone: input.serviceZone, basePaymentMinor: input.basePaymentMinor, active: input.active },
            version: nextVersion,
          })})`;
      return nextVersion;
    });
  } catch (error) {
    if (databaseConstraint(error) === "masters_organization_phone_unique_idx") throw new MasterConflictError();
    throw error;
  }
}
