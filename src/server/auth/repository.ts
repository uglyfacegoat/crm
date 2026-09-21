import "server-only";
import { z } from "zod";
import { getDatabase } from "@/server/database";
import { permissions } from "./permissions";
import { organizationRoles } from "./types";

const credentialRowSchema = z.object({
  organization_id: z.string().uuid(),
  member_id: z.string().uuid(),
  password_hash: z.string().min(1),
  failed_login_attempts: z.number().int().nonnegative(),
  locked_until: z.date().nullable(),
  active: z.boolean(),
});

const sessionRowSchema = z.object({
  session_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  organization_name: z.string(),
  member_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string().email(),
  role: z.enum(organizationRoles),
  master_id: z.string().uuid().nullable(),
  permission_overrides: z.partialRecord(z.enum(permissions), z.boolean()),
});

export type CredentialRecord = z.infer<typeof credentialRowSchema>;
export type SessionRecord = z.infer<typeof sessionRowSchema>;

export async function findCredential(kind: "email" | "phone", normalizedValue: string) {
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      credentials.organization_id,
      credentials.member_id,
      credentials.password_hash,
      credentials.failed_login_attempts,
      credentials.locked_until,
      members.active
    FROM member_login_identities identities
    JOIN member_credentials credentials
      ON credentials.organization_id = identities.organization_id
      AND credentials.member_id = identities.member_id
    JOIN organization_members members
      ON members.organization_id = identities.organization_id
      AND members.id = identities.member_id
    WHERE identities.kind = ${kind}
      AND identities.normalized_value = ${normalizedValue}
    LIMIT 1
  `;
  return rows[0] ? credentialRowSchema.parse(rows[0]) : null;
}

export async function consumeRateLimit(bucketHashes: string[], limit: number, windowMinutes: number) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    let allowed = true;
    for (const bucketHash of bucketHashes) {
      const [row] = await transaction`
        INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempt_count)
        VALUES (${bucketHash}, now(), 1)
        ON CONFLICT (bucket_hash) DO UPDATE SET
          attempt_count = CASE
            WHEN auth_rate_limits.window_started_at <= now() - (${windowMinutes} * interval '1 minute') THEN 1
            ELSE auth_rate_limits.attempt_count + 1
          END,
          window_started_at = CASE
            WHEN auth_rate_limits.window_started_at <= now() - (${windowMinutes} * interval '1 minute') THEN now()
            ELSE auth_rate_limits.window_started_at
          END,
          updated_at = now()
        RETURNING attempt_count
      `;
      if (Number(row.attempt_count) > limit) allowed = false;
    }
    return allowed;
  });
}

export async function recordFailedLogin(credential: CredentialRecord) {
  const sql = getDatabase();
  await sql`
    UPDATE member_credentials SET
      failed_login_attempts = LEAST(failed_login_attempts + 1, 100),
      locked_until = CASE WHEN failed_login_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END,
      updated_at = now()
    WHERE organization_id = ${credential.organization_id}
      AND member_id = ${credential.member_id}
  `;
}

export async function createSession(input: {
  credential: CredentialRecord;
  tokenHash: string;
  clientFingerprintHash: string | null;
  expiresAt: Date;
}) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    await transaction`
      UPDATE member_credentials SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE organization_id = ${input.credential.organization_id}
        AND member_id = ${input.credential.member_id}
    `;
    const [session] = await transaction`
      INSERT INTO auth_sessions (organization_id, member_id, token_hash, client_fingerprint_hash, expires_at)
      VALUES (${input.credential.organization_id}, ${input.credential.member_id}, ${input.tokenHash}, ${input.clientFingerprintHash}, ${input.expiresAt})
      RETURNING id
    `;
    await transaction`
      INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${input.credential.organization_id}, ${input.credential.member_id}, ${session.id}, 'auth.login', 'organization_member', ${input.credential.member_id})
    `;
    return z.string().uuid().parse(session.id);
  });
}

export async function findSessionByTokenHash(tokenHash: string) {
  const sql = getDatabase();
  await sql`
    UPDATE auth_sessions
    SET last_seen_at = now()
    WHERE token_hash = ${tokenHash}
      AND revoked_at IS NULL
      AND expires_at > now()
      AND last_seen_at < now() - interval '30 seconds'
  `;
  const rows = await sql`
    SELECT
      sessions.id AS session_id,
      COALESCE(sessions.active_organization_id, sessions.organization_id) AS organization_id,
      organizations.name AS organization_name,
      COALESCE(sessions.active_member_id, sessions.member_id) AS member_id,
      members.display_name,
      members.email,
      CASE WHEN developer_accounts.email IS NOT NULL THEN 'developer' ELSE members.role END AS role,
      members.master_id,
      COALESCE(permission_overrides.values, '{}'::jsonb) AS permission_overrides
    FROM auth_sessions sessions
    JOIN organization_members members
      ON members.organization_id = COALESCE(sessions.active_organization_id, sessions.organization_id)
      AND members.id = COALESCE(sessions.active_member_id, sessions.member_id)
    JOIN organizations ON organizations.id = COALESCE(sessions.active_organization_id, sessions.organization_id)
    LEFT JOIN developer_accounts ON developer_accounts.email = members.email
    LEFT JOIN LATERAL (
      SELECT jsonb_object_agg(permission, allowed) AS values
      FROM member_permission_overrides
      WHERE organization_id = members.organization_id AND member_id = members.id
    ) permission_overrides ON true
    WHERE sessions.token_hash = ${tokenHash}
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > now()
      AND members.active
      AND (sessions.active_organization_id IS NULL OR EXISTS (
        SELECT 1 FROM organization_access_grants grants
        WHERE grants.principal_organization_id = sessions.organization_id
          AND grants.principal_member_id = sessions.member_id
          AND grants.target_organization_id = sessions.active_organization_id
          AND grants.target_member_id = sessions.active_member_id
      ))
    LIMIT 1
  `;
  return rows[0] ? sessionRowSchema.parse(rows[0]) : null;
}

export async function revokeSession(tokenHash: string) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [session] = await transaction`
      UPDATE auth_sessions SET revoked_at = now()
      WHERE token_hash = ${tokenHash} AND revoked_at IS NULL
      RETURNING id, organization_id, member_id
    `;
    if (!session) return;
    await transaction`
      INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${session.organization_id}, ${session.member_id}, ${session.id}, 'auth.logout', 'organization_member', ${session.member_id})
    `;
  });
}
