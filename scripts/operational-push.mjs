import webPush from "web-push";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 100;

function targetUrl(targetType, targetId, role) {
  if (role === "master" || role === "foreman") return "/my-visits";
  switch (targetType) {
    case "order": return `/orders/${targetId}`;
    case "visit": return "/calendar";
    case "task": return "/tasks";
    case "client": return `/clients/${targetId}`;
    case "document": return `/documents?document=${encodeURIComponent(targetId)}`;
    case "workflow": return `/workflow?map=${encodeURIComponent(targetId)}`;
    default: return "/notifications";
  }
}

export async function sendOperationalPush(sql, environment = process.env, sendNotification = webPush.sendNotification.bind(webPush)) {
  const publicKey = environment.CRM_PUSH_PUBLIC_KEY;
  const privateKey = environment.CRM_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return { sent: 0, failed: 0, expired: 0 };

  const recipients = await sql`
    SELECT notifications.id AS notification_id, notifications.title, notifications.body,
      notifications.target_type, notifications.target_id,
      subscriptions.endpoint, subscriptions.p256dh, subscriptions.auth_secret,
      members.role, coalesce(deliveries.attempts, 0)::integer AS attempts
    FROM notifications
    JOIN chat_push_subscriptions subscriptions
      ON subscriptions.organization_id = notifications.organization_id
      AND subscriptions.member_id = notifications.recipient_member_id
      AND subscriptions.events_enabled
      AND notifications.created_at >= subscriptions.events_enabled_at
    JOIN organization_members members
      ON members.organization_id = subscriptions.organization_id
      AND members.id = subscriptions.member_id AND members.active
      AND coalesce((SELECT allowed FROM member_permission_overrides overrides
        WHERE overrides.organization_id = members.organization_id
          AND overrides.member_id = members.id AND overrides.permission = 'notifications.read'), true)
    JOIN auth_sessions sessions
      ON sessions.id = subscriptions.session_id AND sessions.revoked_at IS NULL
      AND sessions.expires_at > now()
      AND (sessions.active_organization_id IS NULL OR
        (sessions.active_organization_id = subscriptions.organization_id
          AND sessions.active_member_id = subscriptions.member_id))
    LEFT JOIN notification_push_deliveries deliveries
      ON deliveries.notification_id = notifications.id AND deliveries.endpoint = subscriptions.endpoint
    WHERE notifications.resolved_at IS NULL AND notifications.read_at IS NULL
      AND (deliveries.sent_at IS NULL AND (deliveries.retry_at IS NULL OR deliveries.retry_at <= now()))
      AND coalesce(deliveries.attempts, 0) < ${MAX_ATTEMPTS}
      AND (notifications.source_type <> 'workflow' OR
        coalesce((SELECT allowed FROM member_permission_overrides overrides
          WHERE overrides.organization_id = members.organization_id
            AND overrides.member_id = members.id AND overrides.permission = 'workflow.read'),
          members.role IN ('admin', 'dispatcher', 'manager')))
    ORDER BY notifications.created_at, notifications.id
    LIMIT ${BATCH_SIZE}`;

  const result = { sent: 0, failed: 0, expired: 0 };
  for (let index = 0; index < recipients.length; index += 10) {
    await Promise.all(recipients.slice(index, index + 10).map(async (recipient) => {
      const payload = JSON.stringify({
        kind: "event",
        title: String(recipient.title).slice(0, 120),
        body: String(recipient.body).slice(0, 180),
        url: targetUrl(recipient.target_type, recipient.target_id, recipient.role),
        notificationId: recipient.notification_id,
      });
      try {
        await sendNotification({ endpoint: recipient.endpoint,
          keys: { p256dh: recipient.p256dh, auth: recipient.auth_secret } }, payload, {
          TTL: 60 * 60, timeout: 5000, urgency: "normal",
          vapidDetails: { subject: environment.CRM_PUBLIC_ORIGIN ?? "https://workspace-90780.tehstroinvest.ru", publicKey, privateKey },
        });
        await sql`INSERT INTO notification_push_deliveries AS existing
          (notification_id, endpoint, attempts, sent_at, updated_at)
          VALUES (${recipient.notification_id}, ${recipient.endpoint}, 1, now(), now())
          ON CONFLICT (notification_id, endpoint) DO UPDATE SET
            attempts = existing.attempts + 1, sent_at = now(), retry_at = NULL,
            last_status_code = NULL, updated_at = now()`;
        result.sent += 1;
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          && Number.isInteger(error.statusCode) ? error.statusCode : null;
        if (statusCode === 404 || statusCode === 410) {
          await sql`DELETE FROM chat_push_subscriptions WHERE endpoint = ${recipient.endpoint}`;
          result.expired += 1;
          return;
        }
        const retryAt = new Date(Date.now() + Math.min(60_000 * 2 ** Number(recipient.attempts), 900_000));
        await sql`INSERT INTO notification_push_deliveries AS existing
          (notification_id, endpoint, attempts, retry_at, last_status_code, updated_at)
          VALUES (${recipient.notification_id}, ${recipient.endpoint}, 1, ${retryAt}, ${statusCode}, now())
          ON CONFLICT (notification_id, endpoint) DO UPDATE SET
            attempts = existing.attempts + 1, retry_at = EXCLUDED.retry_at,
            last_status_code = EXCLUDED.last_status_code, updated_at = now()`;
        result.failed += 1;
        console.error(JSON.stringify({ operation: "notifications.push.send", category: "delivery_failed", statusCode }));
      }
    }));
  }
  return result;
}
