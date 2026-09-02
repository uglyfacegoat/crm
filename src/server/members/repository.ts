import "server-only";
import type postgres from "postgres";
import { z } from "zod";
import { normalizeLoginIdentity } from "@/server/auth/identity";
import { requirePermission } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { organizationRoles, type AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateMemberInput, ResetMemberPasswordInput, UpdateMemberAccessInput } from "./schemas";
import type { MemberMasterOption, OrganizationMemberListItem } from "./types";

const memberRowSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string(),
  email: z.string().email(),
  phone: z.string().nullable(),
  role: z.enum(organizationRoles),
  active: z.boolean(),
  master_id: z.string().uuid().nullable(),
  master_name: z.string().nullable(),
  last_login_at: z.coerce.date().nullable(),
  version: z.number().int().positive(),
});

const masterOptionRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone: z.string(),
  active: z.boolean(),
  linked_member_id: z.string().uuid().nullable(),
});

export class MemberIdentityConflictError extends Error {
  constructor() { super("The email or phone is already used by another account."); this.name = "MemberIdentityConflictError"; }
}
export class MemberMasterConflictError extends Error {
  constructor() { super("The master profile is already linked to another account."); this.name = "MemberMasterConflictError"; }
}
export class MemberMasterNotFoundError extends Error {
  constructor() { super("The selected active master profile was not found."); this.name = "MemberMasterNotFoundError"; }
}
export class MemberNotFoundError extends Error {
  constructor() { super("The organization member was not found."); this.name = "MemberNotFoundError"; }
}
export class MemberVersionConflictError extends Error {
  constructor() { super("The organization member was changed by another administrator."); this.name = "MemberVersionConflictError"; }
}
export class MemberSelfModificationError extends Error {
  constructor() { super("Administrators cannot change their own access from this screen."); this.name = "MemberSelfModificationError"; }
}
export class MemberSelfPasswordResetError extends Error {
  constructor() { super("Administrators must use the personal security flow to change their own password."); this.name = "MemberSelfPasswordResetError"; }
}

function uniqueConstraint(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23505") return null;
  return "constraint_name" in error && typeof error.constraint_name === "string" ? error.constraint_name : "unknown";
}

function mapMember(row: unknown): OrganizationMemberListItem {
  const member = memberRowSchema.parse(row);
  return {
    id: member.id,
    displayName: member.display_name,
    email: member.email,
    phone: member.phone,
    role: member.role,
    active: member.active,
    masterId: member.master_id,
    masterName: member.master_name,
    lastLoginAt: member.last_login_at?.toISOString() ?? null,
    version: member.version,
  };
}

export async function listOrganizationMembers(member: AuthenticatedMember): Promise<OrganizationMemberListItem[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const rows = await sql`SELECT members.id, members.display_name, members.email, phone_identity.normalized_value AS phone,
      members.role, members.active, members.master_id, masters.full_name AS master_name,
      last_session.last_login_at, members.version
    FROM organization_members members
    LEFT JOIN member_login_identities phone_identity
      ON phone_identity.organization_id = members.organization_id AND phone_identity.member_id = members.id
      AND phone_identity.kind = 'phone'
    LEFT JOIN masters ON masters.organization_id = members.organization_id AND masters.id = members.master_id
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS last_login_at FROM auth_sessions
      WHERE organization_id = members.organization_id AND member_id = members.id
    ) last_session ON true
    WHERE members.organization_id = ${member.organizationId}
    ORDER BY members.active DESC, members.display_name
    LIMIT 500`;
  return rows.map(mapMember);
}

export async function listMemberMasterOptions(member: AuthenticatedMember): Promise<MemberMasterOption[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const rows = await sql`SELECT masters.id, masters.full_name, masters.phone, masters.active,
      linked_member.id AS linked_member_id
    FROM masters
    LEFT JOIN organization_members linked_member
      ON linked_member.organization_id = masters.organization_id AND linked_member.master_id = masters.id
    WHERE masters.organization_id = ${member.organizationId}
    ORDER BY masters.active DESC, masters.full_name
    LIMIT 500`;
  return rows.map((row) => {
    const master = masterOptionRowSchema.parse(row);
    return { id: master.id, fullName: master.full_name, phone: master.phone, active: master.active, linkedMemberId: master.linked_member_id };
  });
}

async function requireAvailableMaster(transaction: postgres.TransactionSql, organizationId: string, masterId: string) {
  const rows = await transaction`SELECT id FROM masters
    WHERE organization_id = ${organizationId} AND id = ${masterId} AND active
    FOR UPDATE`;
  if (!rows.length) throw new MemberMasterNotFoundError();
}

export async function createOrganizationMember(member: AuthenticatedMember, input: CreateMemberInput) {
  requirePermission(member, "settings.write");
  const emailIdentity = normalizeLoginIdentity(input.email);
  if (!emailIdentity || emailIdentity.kind !== "email") throw new TypeError("Validated member email could not be normalized.");
  const phoneIdentity = input.phone ? normalizeLoginIdentity(input.phone) : null;
  if (input.phone && (!phoneIdentity || phoneIdentity.kind !== "phone")) throw new TypeError("Validated member phone could not be normalized.");
  const passwordHash = await hashPassword(input.password);
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
        VALUES (${member.organizationId}, ${input.idempotencyKey}, 'organization_members.create')
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        RETURNING idempotency_key`;
      if (!insertedRequest.length) {
        const [existing] = await transaction`SELECT operation, entity_id FROM idempotency_requests
          WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
        if (existing?.operation !== "organization_members.create" || !existing.entity_id) throw new Error("Idempotency key is already used by another operation.");
        return z.string().uuid().parse(existing.entity_id);
      }
      if (input.masterId) await requireAvailableMaster(transaction, member.organizationId, input.masterId);
      const [created] = await transaction`INSERT INTO organization_members
        (organization_id, display_name, email, role, master_id)
        VALUES (${member.organizationId}, ${input.displayName}, ${emailIdentity.normalizedValue}, ${input.role}, ${input.masterId})
        RETURNING id`;
      const memberId = z.string().uuid().parse(created.id);
      const identities = [emailIdentity, ...(phoneIdentity ? [phoneIdentity] : [])];
      await transaction`INSERT INTO member_login_identities ${transaction(identities.map((identity) => ({
        organization_id: member.organizationId,
        member_id: memberId,
        kind: identity.kind,
        normalized_value: identity.normalizedValue,
        verified_at: new Date(),
      })), "organization_id", "member_id", "kind", "normalized_value", "verified_at")}`;
      await transaction`INSERT INTO member_credentials (organization_id, member_id, password_hash)
        VALUES (${member.organizationId}, ${memberId}, ${passwordHash})`;
      await transaction`UPDATE idempotency_requests SET entity_id = ${memberId}
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'organization_member.create',
          'organization_member', ${memberId}, ${transaction.json({ displayName: input.displayName, email: emailIdentity.normalizedValue, role: input.role, masterId: input.masterId, hasPhone: phoneIdentity !== null })})`;
      return memberId;
    });
  } catch (error) {
    const constraint = uniqueConstraint(error);
    if (constraint === "organization_members_master_unique_idx") throw new MemberMasterConflictError();
    if (constraint === "organization_members_organization_id_email_key" || constraint === "member_login_identities_kind_normalized_value_key") throw new MemberIdentityConflictError();
    throw error;
  }
}

export async function updateOrganizationMemberAccess(member: AuthenticatedMember, input: UpdateMemberAccessInput) {
  requirePermission(member, "settings.write");
  if (input.memberId === member.memberId) throw new MemberSelfModificationError();
  const sql = getDatabase();
  try {
    return await sql.begin(async (transaction) => {
      const [existing] = await transaction`SELECT role, active, master_id, version FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}
        FOR UPDATE`;
      if (!existing) throw new MemberNotFoundError();
      const current = z.object({ role: z.enum(organizationRoles), active: z.boolean(), master_id: z.string().uuid().nullable(), version: z.number().int().positive() }).parse(existing);
      if (current.version !== input.expectedVersion) throw new MemberVersionConflictError();
      if (input.masterId) await requireAvailableMaster(transaction, member.organizationId, input.masterId);

      const [updated] = await transaction`UPDATE organization_members SET role = ${input.role}, master_id = ${input.masterId},
          active = ${input.active}, version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!updated) throw new MemberVersionConflictError();
      const version = z.number().int().positive().parse(updated.version);
      if (!input.active || current.role !== input.role || current.master_id !== input.masterId) {
        await transaction`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now())
          WHERE organization_id = ${member.organizationId} AND member_id = ${input.memberId} AND revoked_at IS NULL`;
      }
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'organization_member.access_update',
          'organization_member', ${input.memberId}, ${transaction.json({
            before: { role: current.role, active: current.active, masterId: current.master_id, version: current.version },
            after: { role: input.role, active: input.active, masterId: input.masterId, version },
          })})`;
      return version;
    });
  } catch (error) {
    if (uniqueConstraint(error) === "organization_members_master_unique_idx") throw new MemberMasterConflictError();
    throw error;
  }
}

export async function resetOrganizationMemberPassword(member: AuthenticatedMember, input: ResetMemberPasswordInput) {
  requirePermission(member, "settings.write");
  if (input.memberId === member.memberId) throw new MemberSelfPasswordResetError();
  const passwordHash = await hashPassword(input.password);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const insertedRequest = await transaction`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation)
      VALUES (${member.organizationId}, ${input.idempotencyKey}, 'organization_members.password_reset')
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING idempotency_key`;
    if (!insertedRequest.length) {
      const [existingRequest] = await transaction`SELECT operation, entity_id FROM idempotency_requests
        WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
      if (existingRequest?.operation !== "organization_members.password_reset" || existingRequest.entity_id !== input.memberId) {
        throw new Error("Idempotency key is already used by another operation.");
      }
      const [currentMember] = await transaction`SELECT version FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}`;
      if (!currentMember) throw new MemberNotFoundError();
      return z.number().int().positive().parse(currentMember.version);
    }

    const [existingMember] = await transaction`SELECT version FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}
      FOR UPDATE`;
    if (!existingMember) throw new MemberNotFoundError();
    const currentVersion = z.number().int().positive().parse(existingMember.version);
    if (currentVersion !== input.expectedVersion) throw new MemberVersionConflictError();

    const updatedCredentials = await transaction`UPDATE member_credentials SET
        password_hash = ${passwordHash}, failed_login_attempts = 0, locked_until = NULL,
        password_changed_at = now(), updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${input.memberId}
      RETURNING member_id`;
    if (!updatedCredentials.length) throw new Error("The organization member has no password credential.");
    const revokedSessions = await transaction`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now())
      WHERE organization_id = ${member.organizationId} AND member_id = ${input.memberId} AND revoked_at IS NULL
      RETURNING id`;
    const [updatedMember] = await transaction`UPDATE organization_members SET version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${input.memberId} AND version = ${input.expectedVersion}
      RETURNING version`;
    if (!updatedMember) throw new MemberVersionConflictError();
    const version = z.number().int().positive().parse(updatedMember.version);
    await transaction`UPDATE idempotency_requests SET entity_id = ${input.memberId}
      WHERE organization_id = ${member.organizationId} AND idempotency_key = ${input.idempotencyKey}`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'organization_member.password_reset',
        'organization_member', ${input.memberId}, ${transaction.json({ revokedSessionCount: revokedSessions.length, memberVersion: version })})`;
    return version;
  });
}
