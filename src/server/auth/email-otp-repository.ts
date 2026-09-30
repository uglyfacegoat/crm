import "server-only";
import { getDatabase } from "@/server/database";
import { createPrivateBucketHash, createSessionToken, hashSessionToken } from "./token";
import { hashEmailOtpCode, matchesEmailOtpCode } from "./email-otp-code.mjs";
import { getEmailOtpSecret, getThrottleSecret } from "./config";
import type { SessionCookie } from "./types";
import type { CredentialRecord } from "./repository";

export const EMAIL_CHALLENGE_COOKIE_NAME = "crm_email_challenge";

export async function emailOtpDeliveryReady() {
  const [row] = await getDatabase()`SELECT status = 'succeeded'
    AND heartbeat_at > now() - interval '2 minutes'
    AND last_result->>'otpReady' = 'true' AS ready
    FROM background_job_status WHERE job_name = 'mail.inbox'`;
  return row?.ready === true;
}

export async function beginEmailChallenge(credential: CredentialRecord, remember: boolean) {
  const token = createSessionToken();
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    await transaction`UPDATE auth_email_challenges SET status = 'failed'
      WHERE organization_id = ${credential.organization_id} AND member_id = ${credential.member_id}
        AND purpose = 'login' AND status IN ('pending', 'sending', 'sent')`;
    await transaction`INSERT INTO auth_email_challenges
      (organization_id, member_id, token_hash, remember_session, expires_at, purpose)
      VALUES (${credential.organization_id}, ${credential.member_id}, ${hashSessionToken(token)},
        ${remember}, now() + interval '10 minutes', 'login')`;
  });
  return token;
}

export async function completeEmailChallenge(token: string, code: string, clientAddress: string | null): Promise<SessionCookie | null> {
  if (token.length < 32 || token.length > 128 || !/^\d{7}$/.test(code)) return null;
  const secret = getEmailOtpSecret();
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [challenge] = await transaction`SELECT challenge.id, challenge.organization_id,
        challenge.member_id, challenge.code_hash, challenge.remember_session
      FROM auth_email_challenges challenge
      JOIN organization_members member ON member.organization_id = challenge.organization_id
        AND member.id = challenge.member_id
      JOIN member_credentials credential ON credential.organization_id = challenge.organization_id
        AND credential.member_id = challenge.member_id
      WHERE challenge.token_hash = ${hashSessionToken(token)} AND challenge.purpose = 'login'
        AND challenge.status = 'sent' AND credential.email_otp_enabled
        AND challenge.expires_at > now() AND challenge.verification_attempts < 5
        AND member.active AND (credential.locked_until IS NULL OR credential.locked_until <= now())
      FOR UPDATE OF challenge`;
    if (!challenge) return null;
    const actualHash = hashEmailOtpCode(secret, challenge.id, code);
    if (!matchesEmailOtpCode(challenge.code_hash, actualHash)) {
      await transaction`UPDATE auth_email_challenges SET
        verification_attempts = verification_attempts + 1,
        status = CASE WHEN verification_attempts + 1 >= 5 THEN 'failed' ELSE status END
        WHERE id = ${challenge.id}`;
      return null;
    }
    await transaction`UPDATE auth_email_challenges SET status = 'consumed', consumed_at = now()
      WHERE id = ${challenge.id}`;
    const sessionToken = createSessionToken();
    const expiresAt = new Date(Date.now() + (challenge.remember_session ? 14 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
    const fingerprint = clientAddress ? createPrivateBucketHash(getThrottleSecret(), `session-client:${clientAddress}`) : null;
    await transaction`UPDATE member_credentials SET failed_login_attempts = 0,
      locked_until = NULL, updated_at = now()
      WHERE organization_id = ${challenge.organization_id} AND member_id = ${challenge.member_id}`;
    const [session] = await transaction`INSERT INTO auth_sessions
      (organization_id, member_id, token_hash, client_fingerprint_hash, expires_at)
      VALUES (${challenge.organization_id}, ${challenge.member_id}, ${hashSessionToken(sessionToken)}, ${fingerprint}, ${expiresAt})
      RETURNING id`;
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id)
      VALUES (${challenge.organization_id}, ${challenge.member_id}, ${session.id},
        'auth.login', 'organization_member', ${challenge.member_id})`;
    return { token: sessionToken, expiresAt };
  });
}
