import "server-only";
import { getDatabase } from "@/server/database";
import { hashPassword, verifyPassword } from "./password";
import { createSessionToken, hashSessionToken } from "./token";
import { getEmailOtpSecret } from "./config";
import { emailOtpDeliveryReady } from "./email-otp-repository";
import { hashEmailOtpCode, matchesEmailOtpCode } from "./email-otp-code.mjs";
import type { AuthenticatedMember } from "./types";

export async function getOwnSecurityState(member: AuthenticatedMember) {
  const [row] = await getDatabase()`SELECT credential.email_otp_enabled,
    EXISTS (SELECT 1 FROM auth_email_challenges challenge
      WHERE challenge.organization_id = credential.organization_id
        AND challenge.member_id = credential.member_id AND challenge.purpose = 'enroll'
        AND challenge.status IN ('pending', 'sending', 'sent') AND challenge.expires_at > now()) AS pending
    FROM member_credentials credential
    WHERE credential.organization_id = ${member.organizationId} AND credential.member_id = ${member.memberId}`;
  return { enabled: row?.email_otp_enabled === true, pending: row?.pending === true };
}

export async function changeOwnPassword(member: AuthenticatedMember, currentPassword: string, nextPassword: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [credential] = await transaction`SELECT password_hash FROM member_credentials
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId} FOR UPDATE`;
    if (!credential || !(await verifyPassword(currentPassword, credential.password_hash))) return false;
    if (await verifyPassword(nextPassword, credential.password_hash)) return false;
    const passwordHash = await hashPassword(nextPassword);
    await transaction`UPDATE member_credentials SET password_hash = ${passwordHash},
      password_changed_at = now(), failed_login_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}`;
    await transaction`UPDATE auth_sessions SET revoked_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}
        AND id <> ${member.sessionId} AND revoked_at IS NULL`;
    await transaction`UPDATE auth_email_challenges SET status = 'failed'
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}
        AND status IN ('pending', 'sending', 'sent')`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'auth.password_changed', 'organization_member', ${member.memberId})`;
    return true;
  });
}

export async function beginOwnEmailOtpEnrollment(member: AuthenticatedMember) {
  if (!(await emailOtpDeliveryReady())) return "mail_unavailable" as const;
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [credential] = await transaction`SELECT email_otp_enabled FROM member_credentials
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId} FOR UPDATE`;
    if (!credential || credential.email_otp_enabled) return "already_enabled" as const;
    await transaction`UPDATE auth_email_challenges SET status = 'failed'
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}
        AND purpose = 'enroll' AND status IN ('pending', 'sending', 'sent')`;
    await transaction`INSERT INTO auth_email_challenges
      (organization_id, member_id, token_hash, purpose, expires_at)
      VALUES (${member.organizationId}, ${member.memberId}, ${hashSessionToken(createSessionToken())},
        'enroll', now() + interval '10 minutes')`;
    return "pending" as const;
  });
}

export async function confirmOwnEmailOtpEnrollment(member: AuthenticatedMember, code: string) {
  if (!/^\d{7}$/.test(code)) return false;
  const secret = getEmailOtpSecret();
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [challenge] = await transaction`SELECT id, code_hash FROM auth_email_challenges
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}
        AND purpose = 'enroll' AND status = 'sent' AND expires_at > now()
        AND verification_attempts < 5
      ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`;
    if (!challenge) return false;
    const actualHash = hashEmailOtpCode(secret, challenge.id, code);
    if (!matchesEmailOtpCode(challenge.code_hash, actualHash)) {
      await transaction`UPDATE auth_email_challenges SET verification_attempts = verification_attempts + 1,
        status = CASE WHEN verification_attempts + 1 >= 5 THEN 'failed' ELSE status END
        WHERE id = ${challenge.id}`;
      return false;
    }
    await transaction`UPDATE auth_email_challenges SET status = 'consumed', consumed_at = now()
      WHERE id = ${challenge.id}`;
    await transaction`UPDATE member_credentials SET email_otp_enabled = true, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'auth.email_otp_enabled', 'organization_member', ${member.memberId})`;
    return true;
  });
}

export async function disableOwnEmailOtp(member: AuthenticatedMember, password: string) {
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [credential] = await transaction`SELECT password_hash, email_otp_enabled FROM member_credentials
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId} FOR UPDATE`;
    if (!credential?.email_otp_enabled || !(await verifyPassword(password, credential.password_hash))) return false;
    await transaction`UPDATE member_credentials SET email_otp_enabled = false, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}`;
    await transaction`UPDATE auth_email_challenges SET status = 'failed'
      WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}
        AND status IN ('pending', 'sending', 'sent')`;
    await transaction`INSERT INTO audit_events (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId},
        'auth.email_otp_disabled', 'organization_member', ${member.memberId})`;
    return true;
  });
}
