const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 5_000;
const MAX_INTERVAL_MS = 3_600_000;

export function parseReminderWorkerInterval(rawValue) {
  if (rawValue === undefined || rawValue === "") return DEFAULT_INTERVAL_MS;
  if (!/^\d+$/.test(rawValue)) throw new Error("REMINDER_WORKER_INTERVAL_MS must be an integer number of milliseconds.");
  const intervalMs = Number(rawValue);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) {
    throw new Error(`REMINDER_WORKER_INTERVAL_MS must be between ${MIN_INTERVAL_MS} and ${MAX_INTERVAL_MS}.`);
  }
  return intervalMs;
}

export function reminderWorkerHealthWindow(intervalMs) {
  return Math.max(intervalMs * 3, 180_000);
}

function reminderCounter(value, field) {
  const counter = typeof value === "bigint" ? Number(value) : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error(`Reminder worker returned an invalid ${field} counter.`);
  return counter;
}

export function parseReminderWorkerResult(result) {
  if (!result || typeof result !== "object") throw new Error("Reminder worker returned an invalid result.");
  return {
    channelsCreated: reminderCounter(result.channels_created, "channels_created"),
    membersSynchronized: reminderCounter(result.members_added, "members_added"),
    visitMessagesSynchronized: reminderCounter(result.visit_messages_upserted, "visit_messages_upserted"),
    closingActMessagesSynchronized: reminderCounter(result.closing_act_messages_upserted, "closing_act_messages_upserted"),
    contractMessagesSynchronized: reminderCounter(result.contract_messages_upserted, "contract_messages_upserted"),
    obsoleteMessagesRemoved: reminderCounter(result.obsolete_messages_removed, "obsolete_messages_removed"),
  };
}

export function parseOperationalNotificationResult(result) {
  if (!result || typeof result !== "object") throw new Error("Notification worker returned an invalid result.");
  return {
    visitNotificationsSynchronized: reminderCounter(result.visit_notifications_upserted, "visit_notifications_upserted"),
    unassignedNotificationsSynchronized: reminderCounter(result.unassigned_notifications_upserted, "unassigned_notifications_upserted"),
    closingActNotificationsSynchronized: reminderCounter(result.closing_act_notifications_upserted, "closing_act_notifications_upserted"),
    taskNotificationsSynchronized: reminderCounter(result.task_notifications_upserted, "task_notifications_upserted"),
    contractNotificationsSynchronized: reminderCounter(result.contract_notifications_upserted, "contract_notifications_upserted"),
    notificationsResolved: reminderCounter(result.notifications_resolved, "notifications_resolved"),
  };
}
