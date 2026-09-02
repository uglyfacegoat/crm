import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOperationalNotificationResult,
  parseReminderWorkerInterval,
  parseReminderWorkerResult,
  reminderWorkerHealthWindow,
} from "./reminder-worker-config.mjs";

test("reminder worker uses a one-minute default interval", () => {
  assert.equal(parseReminderWorkerInterval(undefined), 60_000);
});

test("reminder worker accepts bounded integer intervals", () => {
  assert.equal(parseReminderWorkerInterval("5000"), 5_000);
  assert.equal(parseReminderWorkerInterval("3600000"), 3_600_000);
});

test("reminder worker rejects malformed and unsafe intervals", () => {
  assert.throws(() => parseReminderWorkerInterval("1.5"));
  assert.throws(() => parseReminderWorkerInterval("4999"));
  assert.throws(() => parseReminderWorkerInterval("3600001"));
});

test("health window allows three missed cycles and has a startup floor", () => {
  assert.equal(reminderWorkerHealthWindow(5_000), 180_000);
  assert.equal(reminderWorkerHealthWindow(120_000), 360_000);
});

test("reminder worker result keeps operational message counters separate", () => {
  assert.deepEqual(parseReminderWorkerResult({
    channels_created: "1",
    members_added: 2,
    visit_messages_upserted: 3n,
    closing_act_messages_upserted: "4",
    contract_messages_upserted: 5,
    obsolete_messages_removed: "6",
  }), {
    channelsCreated: 1,
    membersSynchronized: 2,
    visitMessagesSynchronized: 3,
    closingActMessagesSynchronized: 4,
    contractMessagesSynchronized: 5,
    obsoleteMessagesRemoved: 6,
  });
});

test("reminder worker result rejects missing and unsafe counters", () => {
  const validResult = {
    channels_created: 0,
    members_added: 0,
    visit_messages_upserted: 0,
    closing_act_messages_upserted: 0,
    contract_messages_upserted: 0,
    obsolete_messages_removed: 0,
  };
  assert.throws(() => parseReminderWorkerResult({ ...validResult, contract_messages_upserted: -1 }));
  assert.throws(() => parseReminderWorkerResult({ ...validResult, members_added: undefined }));
});

test("notification worker result validates every operational counter", () => {
  assert.deepEqual(parseOperationalNotificationResult({
    visit_notifications_upserted: "1",
    unassigned_notifications_upserted: 2,
    closing_act_notifications_upserted: 3n,
    task_notifications_upserted: "4",
    contract_notifications_upserted: 5,
    notifications_resolved: "6",
  }), {
    visitNotificationsSynchronized: 1,
    unassignedNotificationsSynchronized: 2,
    closingActNotificationsSynchronized: 3,
    taskNotificationsSynchronized: 4,
    contractNotificationsSynchronized: 5,
    notificationsResolved: 6,
  });
  assert.throws(() => parseOperationalNotificationResult({
    visit_notifications_upserted: 0,
    unassigned_notifications_upserted: 0,
    closing_act_notifications_upserted: 0,
    task_notifications_upserted: -1,
    contract_notifications_upserted: 0,
    notifications_resolved: 0,
  }));
});
