import "server-only";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

/** Read-only scope. It must never be used to authorize writes or switch a session. */
export async function readableOrganizationIds(member: AuthenticatedMember): Promise<string[]> {
  if (!member.sessionId || !hasPermission(member, "companies.read")) return [member.organizationId];
  const rows = await getDatabase()`
    SELECT grants.target_organization_id AS id
    FROM auth_sessions sessions
    JOIN organizations center ON center.id = sessions.organization_id AND center.organization_kind = 'center'
    JOIN organization_access_grants grants ON grants.principal_organization_id = sessions.organization_id
      AND grants.principal_member_id = sessions.member_id
    JOIN organizations company ON company.id = grants.target_organization_id AND company.organization_kind = 'company'
    JOIN organization_members target ON target.organization_id = grants.target_organization_id
      AND target.id = grants.target_member_id AND target.active AND target.deleted_at IS NULL
    WHERE sessions.id = ${member.sessionId} AND sessions.organization_id = ${member.organizationId}
      AND sessions.member_id = ${member.memberId}
      AND COALESCE(sessions.active_organization_id, sessions.organization_id) = center.id
      AND sessions.revoked_at IS NULL AND sessions.expires_at > now()`;
  return [...new Set([member.organizationId, ...rows.map((row) => String(row.id))])];
}
