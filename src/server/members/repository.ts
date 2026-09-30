import "server-only";
import type postgres from "postgres";
import { z } from "zod";
import { normalizeLoginIdentity } from "@/server/auth/identity";
import { permissions, requirePermission, type Permission } from "@/server/auth/permissions";
import { hashPassword } from "@/server/auth/password";
import { assignableOrganizationRoles, organizationRoles, type AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { CreateMemberInput, ResetMemberPasswordInput, UpdateMemberAccessInput } from "./schemas";
import { MEMBER_PAGE_SIZE, memberRoleLabels, type MemberDirectoryQuery, type MemberMasterQuery } from "@/lib/member-directory";
import { matchesSearchText } from "@/lib/search-normalization";
import { ORDER_PICKER_PAGE_SIZE, type OrderPickerResult } from "@/lib/order-picker";
import type { MemberDirectoryPage, MemberActivityAccount, MemberMasterOption, OrganizationMemberListItem } from "./types";

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
  permission_overrides: z.partialRecord(z.enum(permissions), z.boolean()),
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
export class MemberProtectedAccountError extends Error {
  constructor() { super("System developer accounts cannot be managed from organization settings."); this.name = "MemberProtectedAccountError"; }
}
export class MemberLegacyRoleChangeError extends Error {
  constructor() { super("Legacy roles can only be retained on their existing accounts."); this.name = "MemberLegacyRoleChangeError"; }
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
    permissionOverrides: member.permission_overrides,
  };
}

// The same scoped projection serves a page and a direct card; an ID lookup must
// never depend on which rows happen to fit on the first directory page.
function memberProjection(sql: ReturnType<typeof getDatabase>) {
  return sql`SELECT members.id, members.display_name, members.email, phone_identity.normalized_value AS phone,
      CASE WHEN developer_accounts.email IS NOT NULL THEN developer_accounts.account_role ELSE members.role END AS role,
      members.active, members.master_id, masters.full_name AS master_name,
      last_session.last_login_at, members.version,
      COALESCE(permission_overrides.values, '{}'::jsonb) AS permission_overrides
    FROM organization_members members
    LEFT JOIN member_login_identities phone_identity
      ON phone_identity.organization_id = members.organization_id AND phone_identity.member_id = members.id
      AND phone_identity.kind = 'phone'
    LEFT JOIN masters ON masters.organization_id = members.organization_id AND masters.id = members.master_id
    LEFT JOIN developer_accounts ON developer_accounts.email = members.email
    LEFT JOIN LATERAL (
      SELECT max(created_at) AS last_login_at FROM auth_sessions
      WHERE organization_id = members.organization_id AND member_id = members.id
    ) last_session ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(permission, allowed) AS values
      FROM member_permission_overrides
      WHERE organization_id = members.organization_id AND member_id = members.id
    ) permission_overrides ON true
`;
}

export async function getOrganizationMember(member: AuthenticatedMember, id: string): Promise<OrganizationMemberListItem | null> {
  requirePermission(member, "settings.write");
  if (!z.string().uuid().safeParse(id).success) return null;
  const sql = getDatabase();
  const [row] = await sql`${memberProjection(sql)}
    WHERE members.organization_id = ${member.organizationId} AND members.id = ${id} AND members.deleted_at IS NULL`;
  return row ? mapMember(row) : null;
}

export async function searchOrganizationMembers(member: AuthenticatedMember, query: MemberDirectoryQuery): Promise<MemberDirectoryPage> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const matchingRoles = Object.entries(memberRoleLabels).filter(([, label]) => matchesSearchText(query.q, [label])).map(([role]) => role);
  const filter = sql`members.organization_id = ${member.organizationId} AND members.deleted_at IS NULL
    AND (${query.status} = 'all' OR members.active = ${query.status === "active"})
    AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', members.display_name, members.email,
      phone_identity.normalized_value, masters.full_name), ${query.q})
      OR (CASE WHEN developer_accounts.email IS NOT NULL THEN developer_accounts.account_role ELSE members.role END) = ANY(${matchingRoles}::text[]))`;
  // A single statement keeps the count and the page in the same database snapshot.
  const [result] = await sql`WITH matching AS (
      SELECT members.id, members.active, members.display_name FROM organization_members members
      LEFT JOIN member_login_identities phone_identity ON phone_identity.organization_id = members.organization_id
        AND phone_identity.member_id = members.id AND phone_identity.kind = 'phone'
      LEFT JOIN masters ON masters.organization_id = members.organization_id AND masters.id = members.master_id
      LEFT JOIN developer_accounts ON developer_accounts.email = members.email
      WHERE ${filter}),
    page_ids AS (SELECT id FROM matching ORDER BY active DESC, display_name, id
      LIMIT ${MEMBER_PAGE_SIZE} OFFSET ${(query.page - 1) * MEMBER_PAGE_SIZE}),
    page_rows AS (${memberProjection(sql)} WHERE members.organization_id = ${member.organizationId}
      AND members.id IN (SELECT id FROM page_ids) AND members.deleted_at IS NULL)
    SELECT (SELECT count(*)::integer FROM matching) AS total,
      COALESCE((SELECT jsonb_agg(page_rows ORDER BY active DESC, display_name, id) FROM page_rows), '[]'::jsonb) AS items`;
  return { items: (result.items as unknown[]).map(mapMember), total: z.number().int().nonnegative().parse(result.total), page: query.page, pageSize: MEMBER_PAGE_SIZE };
}

export async function listMemberActivityAccounts(member: AuthenticatedMember): Promise<MemberActivityAccount[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const rows = await sql`SELECT members.id, members.display_name, members.email,
    CASE WHEN developer_accounts.email IS NOT NULL THEN developer_accounts.account_role ELSE members.role END AS role
    FROM organization_members members LEFT JOIN developer_accounts ON developer_accounts.email = members.email
    WHERE members.organization_id = ${member.organizationId} AND members.deleted_at IS NULL
    ORDER BY members.active DESC, members.display_name, members.id`;
  return rows.map(row => {
    const item = memberRowSchema.pick({ id: true, display_name: true, email: true, role: true }).parse(row);
    return { id: item.id, displayName: item.display_name, email: item.email, role: item.role };
  });
}

export async function listMemberMasterOptions(member: AuthenticatedMember, currentMemberId?: string): Promise<MemberMasterOption[]> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  // Include the currently linked profile even when it is outside the first page
  // or inactive, so opening a card does not silently clear its existing link.
  const rows = await sql`SELECT masters.id, masters.full_name, masters.phone, masters.active, linked_member.id AS linked_member_id
    FROM masters LEFT JOIN organization_members linked_member
      ON linked_member.organization_id = masters.organization_id AND linked_member.master_id = masters.id
    WHERE masters.organization_id = ${member.organizationId}
      AND ((masters.active AND linked_member.id IS NULL) OR linked_member.id = ${currentMemberId ?? null})
    ORDER BY (linked_member.id = ${currentMemberId ?? null}) DESC NULLS LAST, masters.full_name, masters.id
    LIMIT ${ORDER_PICKER_PAGE_SIZE}`;
  return rows.map((row) => {
    const master = masterOptionRowSchema.parse(row);
    return { id: master.id, fullName: master.full_name, phone: master.phone, active: master.active, linkedMemberId: master.linked_member_id };
  });
}

export async function searchMemberMasterOptions(member: AuthenticatedMember, query: MemberMasterQuery): Promise<OrderPickerResult> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  if (query.memberId && !await getOrganizationMember(member, query.memberId)) throw new MemberNotFoundError();
  const rows = await sql`SELECT masters.id, masters.full_name, masters.phone
    FROM masters LEFT JOIN organization_members linked_member
      ON linked_member.organization_id = masters.organization_id AND linked_member.master_id = masters.id
    WHERE masters.organization_id = ${member.organizationId} AND masters.active
      AND (linked_member.id IS NULL OR linked_member.id = ${query.memberId ?? null})
      AND (${query.q} = '' OR crm_search_matches(concat_ws(' ', masters.full_name, masters.phone), ${query.q}))
    ORDER BY masters.full_name, masters.id LIMIT ${ORDER_PICKER_PAGE_SIZE + 1}`;
  return { items: rows.slice(0, ORDER_PICKER_PAGE_SIZE).map(row => ({ id: row.id as string, name: row.full_name as string, detail: row.phone as string })), hasMore: rows.length > ORDER_PICKER_PAGE_SIZE };
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
      const protectedIdentity = await transaction`SELECT 1 FROM developer_accounts WHERE email = ${emailIdentity.normalizedValue}`;
      if (protectedIdentity.length) throw new MemberProtectedAccountError();
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
      const [existing] = await transaction`SELECT role, active, master_id, version,
          EXISTS (SELECT 1 FROM developer_accounts WHERE email = organization_members.email) AS protected_account,
          COALESCE((SELECT jsonb_object_agg(permission, allowed) FROM member_permission_overrides
            WHERE organization_id = organization_members.organization_id AND member_id = organization_members.id), '{}'::jsonb) AS permission_overrides
        FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}
        FOR UPDATE`;
      if (!existing) throw new MemberNotFoundError();
      const current = z.object({ role: z.enum(organizationRoles), active: z.boolean(), master_id: z.string().uuid().nullable(), version: z.number().int().positive(), protected_account: z.boolean(), permission_overrides: z.partialRecord(z.enum(permissions), z.boolean()) }).parse(existing);
      if (current.protected_account) throw new MemberProtectedAccountError();
      if (current.version !== input.expectedVersion) throw new MemberVersionConflictError();
      if (!assignableOrganizationRoles.some((role) => role === input.role) && input.role !== current.role) throw new MemberLegacyRoleChangeError();
      if (input.masterId) await requireAvailableMaster(transaction, member.organizationId, input.masterId);

      const [updated] = await transaction`UPDATE organization_members SET role = ${input.role}, master_id = ${input.masterId},
          active = ${input.active}, version = version + 1, updated_at = now()
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId} AND version = ${input.expectedVersion}
        RETURNING version`;
      if (!updated) throw new MemberVersionConflictError();
      const version = z.number().int().positive().parse(updated.version);
      await transaction`DELETE FROM member_permission_overrides
        WHERE organization_id = ${member.organizationId} AND member_id = ${input.memberId}`;
      const overrides = Object.entries(input.permissionOverrides).map(([permission, allowed]) => ({
        organization_id: member.organizationId,
        member_id: input.memberId,
        permission: permission as Permission,
        allowed,
      }));
      if (overrides.length) {
        await transaction`INSERT INTO member_permission_overrides ${transaction(overrides, "organization_id", "member_id", "permission", "allowed")}`;
      }
      await transaction`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now())
        WHERE revoked_at IS NULL AND (
          (organization_id = ${member.organizationId} AND member_id = ${input.memberId})
          OR (active_organization_id = ${member.organizationId} AND active_member_id = ${input.memberId})
        )`;
      await transaction`INSERT INTO audit_events
        (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
        VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'organization_member.access_update',
          'organization_member', ${input.memberId}, ${transaction.json({
            before: { role: current.role, active: current.active, masterId: current.master_id, permissionOverrides: current.permission_overrides, version: current.version },
            after: { role: input.role, active: input.active, masterId: input.masterId, permissionOverrides: input.permissionOverrides, version },
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
      const [currentMember] = await transaction`SELECT version,
          EXISTS (SELECT 1 FROM developer_accounts WHERE email = organization_members.email) AS protected_account
        FROM organization_members
        WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}`;
      if (!currentMember) throw new MemberNotFoundError();
      const parsedMember = z.object({ version: z.number().int().positive(), protected_account: z.boolean() }).parse(currentMember);
      if (parsedMember.protected_account) throw new MemberProtectedAccountError();
      return parsedMember.version;
    }

    const [existingMember] = await transaction`SELECT version,
        EXISTS (SELECT 1 FROM developer_accounts WHERE email = organization_members.email) AS protected_account
      FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${input.memberId}
      FOR UPDATE`;
    if (!existingMember) throw new MemberNotFoundError();
    const protectedMember = z.object({ version: z.number().int().positive(), protected_account: z.boolean() }).parse(existingMember);
    if (protectedMember.protected_account) throw new MemberProtectedAccountError();
    const currentVersion = protectedMember.version;
    if (currentVersion !== input.expectedVersion) throw new MemberVersionConflictError();
    const passwordHash = await hashPassword(input.password);

    const updatedCredentials = await transaction`UPDATE member_credentials SET
        password_hash = ${passwordHash}, failed_login_attempts = 0, locked_until = NULL,
        password_changed_at = now(), updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${input.memberId}
      RETURNING member_id`;
    if (!updatedCredentials.length) throw new Error("The organization member has no password credential.");
    const revokedSessions = await transaction`UPDATE auth_sessions SET revoked_at = coalesce(revoked_at, now())
      WHERE revoked_at IS NULL AND (
        (organization_id = ${member.organizationId} AND member_id = ${input.memberId})
        OR (active_organization_id = ${member.organizationId} AND active_member_id = ${input.memberId})
      )
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
