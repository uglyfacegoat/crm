import "server-only";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { generateVisitRecurrenceDates } from "@/lib/visits/recurrence";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateContractInput, RenewContractInput, UpdateContractInput } from "./schemas";
import type { ContractHistoryEvent, ContractListItem, ContractSnapshot } from "./types";

const uuidSchema = z.string().uuid();
const contractRowSchema = z.object({
  id: uuidSchema,
  contract_number: z.string(),
  client_id: uuidSchema,
  client_name: z.string(),
  object_id: uuidSchema,
  object_name: z.string(),
  object_address: z.string(),
  status: z.enum(["draft", "active", "suspended", "completed", "cancelled"]),
  starts_on: z.string(),
  ends_on: z.string(),
  renewal_notice_days: z.number().int(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  renewed_from_contract_id: uuidSchema.nullable(),
  renewed_by_contract_id: uuidSchema.nullable(),
  days_until_end: z.number().int(),
  next_visit_at: z.coerce.date().nullable(),
  schedule_rule_id: uuidSchema.nullable(),
  frequency_unit: z.enum(["week", "month"]).nullable(),
  frequency_interval: z.number().int().nullable(),
  local_time: z.string().nullable(),
  duration_minutes: z.number().int().nullable(),
  default_master_id: uuidSchema.nullable(),
  default_master_name: z.string().nullable(),
  visit_count: z.number().int().nonnegative(),
});
const historyRowSchema = z.object({
  id: uuidSchema,
  event_type: z.enum(["created", "updated", "status_changed", "renewed"]),
  actor_name: z.string().nullable(),
  before_state: z.record(z.string(), z.unknown()).nullable(),
  after_state: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  created_at: z.coerce.date(),
});
const mutableContractSchema = z.object({
  contract_number: z.string(),
  status: z.enum(["draft", "active", "suspended", "completed", "cancelled"]),
  starts_on: z.string(),
  ends_on: z.string(),
  renewal_notice_days: z.number().int(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
});
const scheduleRowSchema = z.object({
  frequency_unit: z.enum(["week", "month"]),
  frequency_interval: z.number().int(),
  local_time: z.string(),
  duration_minutes: z.number().int(),
  default_master_id: uuidSchema.nullable(),
  notes: z.string().nullable(),
});

export class ContractNotFoundError extends Error {
  constructor() { super("Contract was not found."); this.name = "ContractNotFoundError"; }
}
export class ContractVersionConflictError extends Error {
  constructor() { super("Contract was changed by another member."); this.name = "ContractVersionConflictError"; }
}
export class ContractReferenceError extends Error {
  constructor(readonly field: "object" | "master") { super(`The selected ${field} is unavailable.`); this.name = "ContractReferenceError"; }
}
export class ContractNumberConflictError extends Error {
  constructor() { super("Contract number already exists."); this.name = "ContractNumberConflictError"; }
}
export class ContractPeriodLockedError extends Error {
  constructor() { super("The historical contract period is locked."); this.name = "ContractPeriodLockedError"; }
}
export class ContractStateTransitionError extends Error {
  constructor() { super("The requested contract state transition is not allowed."); this.name = "ContractStateTransitionError"; }
}
export class ContractAlreadyRenewedError extends Error {
  constructor() { super("The contract already has a renewal."); this.name = "ContractAlreadyRenewedError"; }
}
export class ContractScheduleConflictError extends Error {
  constructor() { super("The selected master has an overlapping visit."); this.name = "ContractScheduleConflictError"; }
}

function databaseConstraint(error: unknown, code: "23505" | "23P01") {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== code) return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function contractState(contract: z.infer<typeof mutableContractSchema>) {
  return {
    contractNumber: contract.contract_number,
    status: contract.status,
    startsOn: contract.starts_on,
    endsOn: contract.ends_on,
    renewalNoticeDays: contract.renewal_notice_days,
    notes: contract.notes,
    version: contract.version,
  };
}

function mapContract(value: unknown): ContractListItem {
  const row = contractRowSchema.parse(value);
  const hasSchedule = row.schedule_rule_id !== null;
  return {
    id: row.id,
    contractNumber: row.contract_number,
    clientId: row.client_id,
    clientName: row.client_name,
    objectId: row.object_id,
    objectName: row.object_name,
    objectAddress: row.object_address,
    status: row.status,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    renewalNoticeDays: row.renewal_notice_days,
    notes: row.notes,
    version: row.version,
    renewedFromContractId: row.renewed_from_contract_id,
    renewedByContractId: row.renewed_by_contract_id,
    daysUntilEnd: row.days_until_end,
    nextVisitAt: row.next_visit_at?.toISOString() ?? null,
    schedule: hasSchedule ? {
      id: row.schedule_rule_id!,
      frequencyUnit: row.frequency_unit!,
      frequencyInterval: row.frequency_interval!,
      localTime: row.local_time!.slice(0, 5),
      durationMinutes: row.duration_minutes!,
      defaultMasterId: row.default_master_id,
      defaultMasterName: row.default_master_name,
      visitCount: row.visit_count,
    } : null,
  };
}

type ScheduleInput = {
  frequencyUnit: "week" | "month";
  frequencyInterval: number;
  localTime: string;
  durationMinutes: number;
  defaultMasterId: string | null;
  notes: string | null;
};

async function createContractSchedule(
  transaction: TransactionSql,
  member: AuthenticatedMember,
  contract: { id: string; number: string; objectId: string; clientName: string; objectName: string; objectAddress: string; startsOn: string; endsOn: string },
  schedule: ScheduleInput,
) {
  const localDates = generateVisitRecurrenceDates(contract.startsOn, contract.endsOn, schedule.frequencyUnit, schedule.frequencyInterval);
  const masterRows = schedule.defaultMasterId
    ? await transaction`SELECT id, full_name, phone FROM masters
        WHERE organization_id = ${member.organizationId} AND id = ${schedule.defaultMasterId} AND active AND operational_status = 'working' FOR KEY SHARE`
    : [];
  if (schedule.defaultMasterId && !masterRows.length) throw new ContractReferenceError("master");
  const master = masterRows[0] ?? null;
  const [rule] = await transaction`INSERT INTO contract_schedule_rules (
      organization_id, contract_id, frequency_unit, frequency_interval, starts_on, ends_on, local_time,
      duration_minutes, default_master_id, notes, created_by, updated_by
    ) VALUES (
      ${member.organizationId}, ${contract.id}, ${schedule.frequencyUnit}, ${schedule.frequencyInterval},
      ${contract.startsOn}, ${contract.endsOn}, ${schedule.localTime}, ${schedule.durationMinutes},
      ${schedule.defaultMasterId}, ${schedule.notes}, ${member.memberId}, ${member.memberId}
    ) RETURNING id`;
  const scheduleRuleId = uuidSchema.parse(rule.id);
  const rangeRows = await transaction`SELECT occurrence.local_date,
      ((occurrence.local_date || ' ' || ${schedule.localTime})::timestamp AT TIME ZONE organizations.timezone) AS start_at,
      ((occurrence.local_date || ' ' || ${schedule.localTime})::timestamp AT TIME ZONE organizations.timezone)
        + make_interval(mins => ${schedule.durationMinutes}) AS end_at
    FROM organizations
    CROSS JOIN jsonb_to_recordset(${transaction.json(localDates.map((localDate) => ({ local_date: localDate })))}::jsonb)
      AS occurrence(local_date text)
    WHERE organizations.id = ${member.organizationId}
    ORDER BY occurrence.local_date`;
  const ranges = rangeRows.map((row) => z.object({ start_at: z.coerce.date(), end_at: z.coerce.date() }).parse(row));
  const visits = ranges.map((range) => ({ scheduled_start_at: range.start_at.toISOString(), scheduled_end_at: range.end_at.toISOString() }));
  await transaction`INSERT INTO service_visits (
      organization_id, contract_id, schedule_rule_id, object_id, assigned_master_id,
      scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot,
      object_address_snapshot, master_name_snapshot, master_phone_snapshot, notes, created_by, updated_by
    ) SELECT ${member.organizationId}, ${contract.id}, ${scheduleRuleId}, ${contract.objectId}, ${schedule.defaultMasterId},
      occurrence.scheduled_start_at, occurrence.scheduled_end_at, 'planned', ${contract.clientName}, ${contract.objectName},
      ${contract.objectAddress}, ${master?.full_name ?? null}, ${master?.phone ?? null}, ${schedule.notes}, ${member.memberId}, ${member.memberId}
    FROM jsonb_to_recordset(${transaction.json(visits)}::jsonb)
      AS occurrence(scheduled_start_at timestamptz, scheduled_end_at timestamptz)`;
  await transaction`INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state)
    SELECT organization_id, id, ${member.memberId}, 'created', jsonb_build_object(
      'contractId', contract_id, 'scheduleRuleId', schedule_rule_id, 'scheduledStartAt', scheduled_start_at,
      'scheduledEndAt', scheduled_end_at, 'status', status, 'assignedMasterId', assigned_master_id, 'notes', notes
    ) FROM service_visits WHERE organization_id = ${member.organizationId} AND schedule_rule_id = ${scheduleRuleId}`;
  await transaction`INSERT INTO tasks (
      organization_id, title, description, priority, due_at, assigned_member_id, related_visit_id,
      source, reminder_kind, created_by, updated_by
    ) SELECT organization_id, ${`Подготовить выезд по договору ${contract.number}`},
      'Автоматическое напоминание по договорному графику.', 'high', scheduled_start_at - interval '1 day',
      ${member.memberId}, id, 'visit_reminder', 'prepare_visit', ${member.memberId}, ${member.memberId}
    FROM service_visits WHERE organization_id = ${member.organizationId} AND schedule_rule_id = ${scheduleRuleId}`;
  return ranges.length;
}

export async function listContracts(member: AuthenticatedMember): Promise<ContractSnapshot> {
  requirePermission(member, "contracts.read");
  const sql = getDatabase();
  const [contractRows, objectRows, masterRows] = await Promise.all([
    sql`SELECT contracts.id, contracts.contract_number, contracts.client_id, clients.legal_name AS client_name,
        contracts.object_id, client_objects.name AS object_name, client_objects.address AS object_address,
        contracts.status, contracts.starts_on::text, contracts.ends_on::text, contracts.renewal_notice_days,
        contracts.notes, contracts.version, contracts.renewed_from_contract_id, successor.id AS renewed_by_contract_id,
        (contracts.ends_on - (now() AT TIME ZONE organizations.timezone)::date)::integer AS days_until_end,
        next_visit.next_visit_at, rules.id AS schedule_rule_id, rules.frequency_unit, rules.frequency_interval,
        rules.local_time::text, rules.duration_minutes, rules.default_master_id, masters.full_name AS default_master_name,
        coalesce(visit_totals.visit_count, 0)::integer AS visit_count
      FROM contracts
      JOIN organizations ON organizations.id = contracts.organization_id
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
      LEFT JOIN contracts successor ON successor.organization_id = contracts.organization_id AND successor.renewed_from_contract_id = contracts.id
      LEFT JOIN contract_schedule_rules rules ON rules.organization_id = contracts.organization_id AND rules.contract_id = contracts.id
      LEFT JOIN masters ON masters.organization_id = rules.organization_id AND masters.id = rules.default_master_id
      LEFT JOIN LATERAL (SELECT min(scheduled_start_at) AS next_visit_at FROM service_visits
        WHERE organization_id = contracts.organization_id AND contract_id = contracts.id
          AND status IN ('planned', 'confirmed') AND scheduled_start_at >= now()) next_visit ON true
      LEFT JOIN LATERAL (SELECT count(*)::integer AS visit_count FROM service_visits
        WHERE organization_id = contracts.organization_id AND contract_id = contracts.id) visit_totals ON true
      WHERE contracts.organization_id = ${member.organizationId}
      ORDER BY CASE contracts.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END,
        contracts.ends_on, contracts.created_at DESC
      LIMIT 500`,
    sql`SELECT client_objects.id, client_objects.client_id, clients.legal_name AS client_name,
        client_objects.name, client_objects.address
      FROM client_objects JOIN clients ON clients.organization_id = client_objects.organization_id AND clients.id = client_objects.client_id
      WHERE client_objects.organization_id = ${member.organizationId}
      ORDER BY clients.legal_name, client_objects.name LIMIT 1000`,
    sql`SELECT id, full_name, service_region AS region FROM masters
      WHERE organization_id = ${member.organizationId} AND active AND operational_status = 'working' ORDER BY full_name LIMIT 500`,
  ]);
  const contracts = contractRows.map(mapContract);
  return {
    contracts,
    objectOptions: objectRows.map((row) => z.object({ id: uuidSchema, client_id: uuidSchema, client_name: z.string(), name: z.string(), address: z.string() }).parse(row)).map((row) => ({ id: row.id, clientId: row.client_id, clientName: row.client_name, name: row.name, address: row.address })),
    masterOptions: masterRows.map((row) => z.object({ id: uuidSchema, full_name: z.string(), region: z.string() }).parse(row)).map((row) => ({ id: row.id, name: row.full_name, region: row.region })),
    summary: {
      total: contracts.length,
      active: contracts.filter((contract) => contract.status === "active").length,
      expiring: contracts.filter((contract) => contract.status === "active" && contract.daysUntilEnd >= 0 && contract.daysUntilEnd <= contract.renewalNoticeDays).length,
      scheduledVisits: contracts.reduce((total, contract) => total + (contract.schedule?.visitCount ?? 0), 0),
    },
  };
}

export async function getContract(member: AuthenticatedMember, contractId: string): Promise<ContractListItem> {
  requirePermission(member, "contracts.read");
  const [row] = await getDatabase()`SELECT contracts.id, contracts.contract_number, contracts.client_id, clients.legal_name AS client_name,
      contracts.object_id, client_objects.name AS object_name, client_objects.address AS object_address,
      contracts.status, contracts.starts_on::text, contracts.ends_on::text, contracts.renewal_notice_days,
      contracts.notes, contracts.version, contracts.renewed_from_contract_id, successor.id AS renewed_by_contract_id,
      (contracts.ends_on - (now() AT TIME ZONE organizations.timezone)::date)::integer AS days_until_end,
      next_visit.next_visit_at, rules.id AS schedule_rule_id, rules.frequency_unit, rules.frequency_interval,
      rules.local_time::text, rules.duration_minutes, rules.default_master_id, masters.full_name AS default_master_name,
      coalesce(visit_totals.visit_count, 0)::integer AS visit_count
    FROM contracts
    JOIN organizations ON organizations.id = contracts.organization_id
    JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
    JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
    LEFT JOIN contracts successor ON successor.organization_id = contracts.organization_id AND successor.renewed_from_contract_id = contracts.id
    LEFT JOIN contract_schedule_rules rules ON rules.organization_id = contracts.organization_id AND rules.contract_id = contracts.id
    LEFT JOIN masters ON masters.organization_id = rules.organization_id AND masters.id = rules.default_master_id
    LEFT JOIN LATERAL (SELECT min(scheduled_start_at) AS next_visit_at FROM service_visits
      WHERE organization_id = contracts.organization_id AND contract_id = contracts.id
        AND status IN ('planned', 'confirmed') AND scheduled_start_at >= now()) next_visit ON true
    LEFT JOIN LATERAL (SELECT count(*)::integer AS visit_count FROM service_visits
      WHERE organization_id = contracts.organization_id AND contract_id = contracts.id) visit_totals ON true
    WHERE contracts.organization_id = ${member.organizationId} AND contracts.id = ${contractId}`;
  if (!row) throw new ContractNotFoundError();
  return mapContract(row);
}

export async function createContract(member: AuthenticatedMember, input: CreateContractInput) {
  requirePermission(member, "contracts.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'contracts.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "contracts.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(existing.entity_id);
      }
      const [object] = await transaction`SELECT client_objects.id, client_objects.name, client_objects.address, clients.legal_name AS client_name
        FROM client_objects JOIN clients ON clients.organization_id = client_objects.organization_id AND clients.id = client_objects.client_id
        WHERE client_objects.organization_id = ${member.organizationId} AND client_objects.id = ${input.objectId}
          AND client_objects.client_id = ${input.clientId} FOR KEY SHARE OF client_objects`;
      if (!object) throw new ContractReferenceError("object");
      const [contract] = await transaction`INSERT INTO contracts (
          organization_id, client_id, object_id, contract_number, status, starts_on, ends_on,
          renewal_notice_days, notes, idempotency_key, created_by, updated_by
        ) VALUES (${member.organizationId}, ${input.clientId}, ${input.objectId}, ${input.contractNumber}, ${input.status},
          ${input.startsOn}, ${input.endsOn}, ${input.renewalNoticeDays}, ${input.notes}, ${input.idempotencyKey},
          ${member.memberId}, ${member.memberId}) RETURNING id`;
      const contractId = uuidSchema.parse(contract.id);
      let visitCount = 0;
      if (input.scheduleEnabled) visitCount = await createContractSchedule(transaction, member, {
        id: contractId, number: input.contractNumber, objectId: input.objectId, clientName: z.string().parse(object.client_name),
        objectName: z.string().parse(object.name), objectAddress: z.string().parse(object.address), startsOn: input.startsOn, endsOn: input.endsOn,
      }, { frequencyUnit: input.frequencyUnit, frequencyInterval: input.frequencyInterval, localTime: input.localTime, durationMinutes: input.durationMinutes, defaultMasterId: input.defaultMasterId, notes: input.notes });
      const state = { contractNumber: input.contractNumber, status: input.status, startsOn: input.startsOn, endsOn: input.endsOn, renewalNoticeDays: input.renewalNoticeDays, notes: input.notes, version: 1, visitCount };
      await transaction`INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, after_state)
        VALUES (${member.organizationId}, ${contractId}, ${member.memberId}, 'created', ${transaction.json(state)})`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${contractId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'contract.create', 'contract', ${contractId}, ${transaction.json(state)})`;
      return contractId;
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "contracts_organization_id_contract_number_key") throw new ContractNumberConflictError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new ContractScheduleConflictError();
    throw error;
  }
}

const transitions = {
  draft: new Set(["draft", "active", "cancelled"]),
  active: new Set(["active", "suspended", "completed", "cancelled"]),
  suspended: new Set(["suspended", "active", "completed", "cancelled"]),
  completed: new Set(["completed"]),
  cancelled: new Set(["cancelled"]),
} as const;

export async function updateContract(member: AuthenticatedMember, input: UpdateContractInput) {
  requirePermission(member, "contracts.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [row] = await transaction`SELECT contract_number, status, starts_on::text, ends_on::text, renewal_notice_days,
          notes, version, EXISTS (SELECT 1 FROM service_visits WHERE organization_id = contracts.organization_id AND contract_id = contracts.id) AS has_visits
        FROM contracts WHERE organization_id = ${member.organizationId} AND id = ${input.contractId} FOR UPDATE`;
      if (!row) throw new ContractNotFoundError();
      const existing = mutableContractSchema.parse(row);
      if (existing.version !== input.expectedVersion) throw new ContractVersionConflictError();
      if (!transitions[existing.status].has(input.status)) throw new ContractStateTransitionError();
      const periodChanged = existing.starts_on !== input.startsOn || existing.ends_on !== input.endsOn;
      if (periodChanged && (existing.status !== "draft" || z.boolean().parse(row.has_visits))) throw new ContractPeriodLockedError();
      const [updated] = await transaction`UPDATE contracts SET contract_number = ${input.contractNumber}, status = ${input.status},
          starts_on = ${input.startsOn}, ends_on = ${input.endsOn}, renewal_notice_days = ${input.renewalNoticeDays},
          notes = ${input.notes}, version = version + 1, updated_by = ${member.memberId}, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.contractId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!updated) throw new ContractVersionConflictError();
      const version = z.number().int().positive().parse(updated.version);
      const beforeState = contractState(existing);
      const afterState = { contractNumber: input.contractNumber, status: input.status, startsOn: input.startsOn, endsOn: input.endsOn, renewalNoticeDays: input.renewalNoticeDays, notes: input.notes, version };
      const eventType = existing.status === input.status ? "updated" : "status_changed";
      await transaction`INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, before_state, after_state, reason)
        VALUES (${member.organizationId}, ${input.contractId}, ${member.memberId}, ${eventType}, ${transaction.json(beforeState)}, ${transaction.json(afterState)}, ${input.reason})`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'contract.update', 'contract', ${input.contractId}, ${transaction.json({ before: beforeState, after: afterState, reason: input.reason })})`;
      return version;
    });
  } catch (error) {
    if (databaseConstraint(error, "23505") === "contracts_organization_id_contract_number_key") throw new ContractNumberConflictError();
    throw error;
  }
}

export async function renewContract(member: AuthenticatedMember, input: RenewContractInput) {
  requirePermission(member, "contracts.write");
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'contracts.renew')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [request] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (request?.operation !== "contracts.renew" || !request.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return uuidSchema.parse(request.entity_id);
      }
      const [sourceRow] = await transaction`SELECT contracts.id, contracts.client_id, contracts.object_id, contracts.contract_number,
          contracts.status, contracts.starts_on::text, contracts.ends_on::text, contracts.renewal_notice_days, contracts.notes,
          contracts.version, clients.legal_name AS client_name, client_objects.name AS object_name, client_objects.address AS object_address,
          successor.id AS successor_id
        FROM contracts
        JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
        JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
        LEFT JOIN contracts successor ON successor.organization_id = contracts.organization_id AND successor.renewed_from_contract_id = contracts.id
        WHERE contracts.organization_id = ${member.organizationId} AND contracts.id = ${input.sourceContractId} FOR UPDATE OF contracts`;
      if (!sourceRow) throw new ContractNotFoundError();
      const source = mutableContractSchema.parse(sourceRow);
      if (source.version !== input.expectedVersion) throw new ContractVersionConflictError();
      if (sourceRow.successor_id) throw new ContractAlreadyRenewedError();
      if (source.status === "draft" || source.status === "cancelled") throw new ContractStateTransitionError();
      if (input.startsOn <= source.ends_on) throw new ContractPeriodLockedError();
      const [contract] = await transaction`INSERT INTO contracts (
          organization_id, client_id, object_id, contract_number, status, starts_on, ends_on, renewal_notice_days,
          notes, idempotency_key, renewed_from_contract_id, created_by, updated_by
        ) VALUES (${member.organizationId}, ${sourceRow.client_id}, ${sourceRow.object_id}, ${input.contractNumber}, 'active',
          ${input.startsOn}, ${input.endsOn}, ${input.renewalNoticeDays}, ${source.notes}, ${input.idempotencyKey},
          ${input.sourceContractId}, ${member.memberId}, ${member.memberId}) RETURNING id`;
      const contractId = uuidSchema.parse(contract.id);
      const scheduleRows = input.copySchedule ? await transaction`SELECT frequency_unit, frequency_interval, local_time::text,
          duration_minutes, default_master_id, notes FROM contract_schedule_rules
        WHERE organization_id = ${member.organizationId} AND contract_id = ${input.sourceContractId} AND active` : [];
      let visitCount = 0;
      if (scheduleRows.length) {
        const schedule = scheduleRowSchema.parse(scheduleRows[0]);
        visitCount = await createContractSchedule(transaction, member, {
          id: contractId, number: input.contractNumber, objectId: uuidSchema.parse(sourceRow.object_id),
          clientName: z.string().parse(sourceRow.client_name), objectName: z.string().parse(sourceRow.object_name),
          objectAddress: z.string().parse(sourceRow.object_address), startsOn: input.startsOn, endsOn: input.endsOn,
        }, { frequencyUnit: schedule.frequency_unit, frequencyInterval: schedule.frequency_interval, localTime: schedule.local_time.slice(0, 5), durationMinutes: schedule.duration_minutes, defaultMasterId: schedule.default_master_id, notes: schedule.notes });
      }
      const [sourceUpdate] = await transaction`UPDATE contracts SET version = version + 1, updated_by = ${member.memberId}, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.sourceContractId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!sourceUpdate) throw new ContractVersionConflictError();
      const renewalState = { renewedByContractId: contractId, contractNumber: input.contractNumber, startsOn: input.startsOn, endsOn: input.endsOn, visitCount };
      await transaction`INSERT INTO contract_events (organization_id, contract_id, actor_id, event_type, before_state, after_state)
        VALUES (${member.organizationId}, ${input.sourceContractId}, ${member.memberId}, 'renewed', ${transaction.json(contractState(source))}, ${transaction.json(renewalState)}),
          (${member.organizationId}, ${contractId}, ${member.memberId}, 'created', NULL, ${transaction.json({ ...renewalState, status: 'active', renewalNoticeDays: input.renewalNoticeDays, version: 1 })})`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${contractId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'contract.renew', 'contract', ${contractId}, ${transaction.json({ sourceContractId: input.sourceContractId, ...renewalState })})`;
      return contractId;
    });
  } catch (error) {
    const constraint = databaseConstraint(error, "23505");
    if (constraint === "contracts_organization_id_contract_number_key") throw new ContractNumberConflictError();
    if (constraint === "contracts_single_renewal_idx") throw new ContractAlreadyRenewedError();
    if (databaseConstraint(error, "23P01") === "service_visits_master_no_overlap") throw new ContractScheduleConflictError();
    throw error;
  }
}

export async function listContractHistory(member: AuthenticatedMember, contractId: string): Promise<ContractHistoryEvent[]> {
  requirePermission(member, "contracts.read");
  const sql = getDatabase();
  const [exists, rows] = await Promise.all([
    sql`SELECT id FROM contracts WHERE organization_id = ${member.organizationId} AND id = ${contractId}`,
    sql`SELECT contract_events.id, contract_events.event_type, contract_events.before_state,
        contract_events.after_state, contract_events.reason, contract_events.created_at,
        organization_members.display_name AS actor_name
      FROM contract_events LEFT JOIN organization_members
        ON organization_members.organization_id = contract_events.organization_id AND organization_members.id = contract_events.actor_id
      WHERE contract_events.organization_id = ${member.organizationId} AND contract_events.contract_id = ${contractId}
      ORDER BY contract_events.created_at DESC, contract_events.id DESC LIMIT 200`,
  ]);
  if (!exists.length) throw new ContractNotFoundError();
  return rows.map((row) => historyRowSchema.parse(row)).map((row) => ({ id: row.id, eventType: row.event_type, actorName: row.actor_name, beforeState: row.before_state, afterState: row.after_state, reason: row.reason, createdAt: row.created_at.toISOString() }));
}
