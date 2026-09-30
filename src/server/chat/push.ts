import "server-only";
import webPush from "web-push";
import { z } from "zod";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

const pushHosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "notify.windows.com", "wns.windows.com"];

function validPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && pushHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export const chatPushSubscriptionSchema = z.object({
  endpoint: z.string().min(20).max(2048).refine(validPushEndpoint),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,256}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{10,256}$/),
  }),
});

const endpointSchema = z.object({ endpoint: chatPushSubscriptionSchema.shape.endpoint });
export type PushKind = "chat" | "events";

export function chatPushPublicKey() {
  return process.env.CRM_PUSH_PUBLIC_KEY && process.env.CRM_PUSH_PRIVATE_KEY
    ? process.env.CRM_PUSH_PUBLIC_KEY : null;
}

export async function listPushPreferences(member: AuthenticatedMember) {
  const sql = getDatabase();
  return z.array(z.object({ endpoint: z.string(), chatEnabled: z.boolean(), eventsEnabled: z.boolean() })).parse(await sql`
    SELECT endpoint, chat_enabled AS "chatEnabled", events_enabled AS "eventsEnabled"
    FROM chat_push_subscriptions
    WHERE organization_id = ${member.organizationId} AND member_id = ${member.memberId}`);
}

export async function restorePushSubscription(member: AuthenticatedMember, input: z.infer<typeof chatPushSubscriptionSchema>) {
  const sql = getDatabase();
  const [preference] = await sql`UPDATE chat_push_subscriptions SET
    session_id = ${member.sessionId}, p256dh = ${input.keys.p256dh}, auth_secret = ${input.keys.auth},
    events_enabled_at = CASE WHEN events_enabled AND session_id IS DISTINCT FROM ${member.sessionId}
      THEN now() ELSE events_enabled_at END,
    updated_at = now()
    WHERE endpoint = ${input.endpoint} AND organization_id = ${member.organizationId}
      AND member_id = ${member.memberId}
    RETURNING chat_enabled AS "chatEnabled", events_enabled AS "eventsEnabled"`;
  return z.object({ chatEnabled: z.boolean(), eventsEnabled: z.boolean() }).nullable().parse(preference ?? null);
}

export async function savePushSubscription(member: AuthenticatedMember, input: z.infer<typeof chatPushSubscriptionSchema>, kind: PushKind) {
  const sql = getDatabase();
  await sql`INSERT INTO chat_push_subscriptions AS existing
    (endpoint, organization_id, member_id, session_id, p256dh, auth_secret,
      chat_enabled, events_enabled, events_enabled_at)
    VALUES (${input.endpoint}, ${member.organizationId}, ${member.memberId}, ${member.sessionId},
      ${input.keys.p256dh}, ${input.keys.auth}, ${kind === "chat"}, ${kind === "events"},
      ${kind === "events" ? new Date() : null})
    ON CONFLICT (endpoint) DO UPDATE SET
      organization_id = EXCLUDED.organization_id, member_id = EXCLUDED.member_id,
      session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh,
      auth_secret = EXCLUDED.auth_secret,
      chat_enabled = CASE WHEN ${kind} = 'chat' THEN true
        WHEN existing.member_id = EXCLUDED.member_id AND existing.organization_id = EXCLUDED.organization_id
          THEN existing.chat_enabled ELSE false END,
      events_enabled = CASE WHEN ${kind} = 'events' THEN true
        WHEN existing.member_id = EXCLUDED.member_id AND existing.organization_id = EXCLUDED.organization_id
          THEN existing.events_enabled ELSE false END,
      events_enabled_at = CASE WHEN ${kind} = 'events' THEN
        CASE WHEN existing.member_id = EXCLUDED.member_id AND existing.organization_id = EXCLUDED.organization_id
          AND existing.events_enabled AND existing.session_id = EXCLUDED.session_id
          THEN existing.events_enabled_at ELSE now() END
        WHEN existing.member_id = EXCLUDED.member_id AND existing.organization_id = EXCLUDED.organization_id
          THEN CASE WHEN existing.events_enabled AND existing.session_id IS DISTINCT FROM EXCLUDED.session_id
            THEN now() ELSE existing.events_enabled_at END ELSE NULL END,
      updated_at = now()`;
}

export async function disablePushSubscription(member: AuthenticatedMember, input: unknown, kind: PushKind) {
  const { endpoint } = endpointSchema.parse(input);
  const sql = getDatabase();
  await sql`UPDATE chat_push_subscriptions SET
    chat_enabled = CASE WHEN ${kind} = 'chat' THEN false ELSE chat_enabled END,
    events_enabled = CASE WHEN ${kind} = 'events' THEN false ELSE events_enabled END,
    events_enabled_at = CASE WHEN ${kind} = 'events' THEN NULL ELSE events_enabled_at END,
    updated_at = now()
    WHERE endpoint = ${endpoint} AND session_id = ${member.sessionId}
      AND member_id = ${member.memberId} AND organization_id = ${member.organizationId}`;
}

const recipientSchema = z.object({
  endpoint: z.string(), p256dh: z.string(), auth_secret: z.string(), channel_name: z.string(),
});

export async function listChatPushRecipients(member: AuthenticatedMember, channelId: string) {
  const sql = getDatabase();
  return z.array(recipientSchema).parse(await sql`
    SELECT subscriptions.endpoint, subscriptions.p256dh, subscriptions.auth_secret,
      channels.name AS channel_name
    FROM chat_push_subscriptions subscriptions
    JOIN chat_channel_members memberships
      ON memberships.organization_id = subscriptions.organization_id
      AND memberships.member_id = subscriptions.member_id
      AND memberships.channel_id = ${channelId} AND NOT memberships.muted
    JOIN chat_channels channels
      ON channels.organization_id = memberships.organization_id AND channels.id = memberships.channel_id
      AND channels.archived_at IS NULL
    JOIN organization_members recipients
      ON recipients.organization_id = subscriptions.organization_id
      AND recipients.id = subscriptions.member_id AND recipients.active
      AND coalesce((SELECT allowed FROM member_permission_overrides overrides
        WHERE overrides.organization_id = recipients.organization_id
          AND overrides.member_id = recipients.id AND overrides.permission = 'chat.read'), true)
    JOIN auth_sessions sessions
      ON sessions.id = subscriptions.session_id AND sessions.revoked_at IS NULL
      AND sessions.expires_at > now()
      AND (sessions.active_organization_id IS NULL OR
        (sessions.active_organization_id = subscriptions.organization_id
          AND sessions.active_member_id = subscriptions.member_id))
    WHERE subscriptions.organization_id = ${member.organizationId}
      AND subscriptions.chat_enabled
      AND subscriptions.member_id <> ${member.memberId}`);
}

export async function sendChatPush(member: AuthenticatedMember, channelId: string, messageId: string, body: string) {
  const publicKey = chatPushPublicKey();
  const privateKey = process.env.CRM_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;
  const sql = getDatabase();
  const recipients = await listChatPushRecipients(member, channelId);
  const payload = (channelName: string) => JSON.stringify({
    title: `${member.displayName} · ${channelName}`,
    body: body.slice(0, 160), channelId, messageId,
  });
  for (let index = 0; index < recipients.length; index += 20) {
    await Promise.all(recipients.slice(index, index + 20).map(async (recipient) => {
      try {
        await webPush.sendNotification({ endpoint: recipient.endpoint,
          keys: { p256dh: recipient.p256dh, auth: recipient.auth_secret } },
        payload(recipient.channel_name), {
          TTL: 60 * 60, timeout: 5000, urgency: "high",
          vapidDetails: { subject: process.env.CRM_PUBLIC_ORIGIN ?? "https://workspace-90780.tehstroinvest.ru", publicKey, privateKey },
        });
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? error.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          await sql`DELETE FROM chat_push_subscriptions WHERE endpoint = ${recipient.endpoint}`;
        } else {
          console.error(JSON.stringify({ operation: "chat.push.send", category: "delivery_failed", statusCode,
            messageId, channelId }));
        }
      }
    }));
  }
}
