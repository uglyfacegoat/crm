import "server-only";
import { z } from "zod";
import { getThrottleSecret } from "./config";
import { normalizeLoginIdentity } from "./identity";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "./password";
import { consumeRateLimit, createSession, findCredential, findSessionByTokenHash, recordFailedLogin, revokeSession } from "./repository";
import { createPrivateBucketHash, createSessionToken, hashSessionToken } from "./token";
import type { AuthenticatedMember, SessionCookie } from "./types";

const loginInputSchema = z.object({
  identity: z.string().trim().min(3).max(254),
  password: z.string().min(8).max(128),
  remember: z.boolean(),
  clientAddress: z.string().max(128).nullable(),
});

export type AuthenticationResult =
  | { ok: true; session: SessionCookie }
  | { ok: false; reason: "invalid_credentials" | "rate_limited" | "account_locked" };

export async function authenticateMember(input: z.input<typeof loginInputSchema>): Promise<AuthenticationResult> {
  const parsed = loginInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_credentials" };

  const identity = normalizeLoginIdentity(parsed.data.identity);
  const secret = getThrottleSecret();
  const identityBucket = createPrivateBucketHash(secret, `identity:${identity?.normalizedValue ?? parsed.data.identity.toLocaleLowerCase("ru")}`);
  const identityAllowed = await consumeRateLimit([identityBucket], 10, 15);
  const clientAllowed = parsed.data.clientAddress
    ? await consumeRateLimit([createPrivateBucketHash(secret, `client:${parsed.data.clientAddress}`)], 50, 15)
    : true;
  const rateLimitAllowed = identityAllowed && clientAllowed;

  const credential = identity ? await findCredential(identity.kind, identity.normalizedValue) : null;
  const passwordValid = await verifyPassword(parsed.data.password, credential?.password_hash ?? DUMMY_PASSWORD_HASH);
  if (!rateLimitAllowed) return { ok: false, reason: "rate_limited" };

  const accountLocked = credential?.locked_until ? credential.locked_until.getTime() > Date.now() : false;
  if (!credential || !passwordValid || !credential.active || accountLocked) {
    if (credential && !accountLocked) await recordFailedLogin(credential);
    return { ok: false, reason: accountLocked ? "account_locked" : "invalid_credentials" };
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + (parsed.data.remember ? 14 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000));
  const clientFingerprintHash = parsed.data.clientAddress ? createPrivateBucketHash(secret, `session-client:${parsed.data.clientAddress}`) : null;
  await createSession({ credential, tokenHash: hashSessionToken(token), clientFingerprintHash, expiresAt });
  return { ok: true, session: { token, expiresAt } };
}

export async function resolveSession(token: string): Promise<AuthenticatedMember | null> {
  if (token.length < 32 || token.length > 128) return null;
  const session = await findSessionByTokenHash(hashSessionToken(token));
  if (!session) return null;
  return {
    sessionId: session.session_id,
    organizationId: session.organization_id,
    organizationName: session.organization_name,
    memberId: session.member_id,
    displayName: session.display_name,
    email: session.email,
    role: session.role,
    masterId: session.master_id,
    permissionOverrides: session.permission_overrides,
  };
}

export async function endSession(token: string) {
  if (token.length < 32 || token.length > 128) return;
  await revokeSession(hashSessionToken(token));
}
