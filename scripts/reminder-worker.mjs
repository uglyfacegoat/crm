import { safeCliErrorCode } from "./safe-cli-error.mjs";
import postgres from "postgres";
import {
  parseOperationalNotificationResult,
  parseReminderWorkerResult,
  reminderWorkerHealthWindow,
} from "./reminder-worker-config.mjs";
import { validateReminderWorkerEnvironment } from "./worker-runtime-config.mjs";

const JOB_NAME = "chat.visit-reminders";
const { databaseUrl, intervalMs } = validateReminderWorkerEnvironment(process.env);

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => undefined,
});

async function checkHealth() {
  const healthWindowMs = reminderWorkerHealthWindow(intervalMs);
  const [status] = await sql`
    SELECT heartbeat_at > now() - (${healthWindowMs}::bigint * interval '1 millisecond') AS healthy
    FROM background_job_status
    WHERE job_name = ${JOB_NAME}
  `;
  if (status?.healthy !== true) process.exitCode = 1;
}

async function runCycle() {
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [lockResult] = await connection`SELECT pg_try_advisory_lock(hashtext(${JOB_NAME})) AS locked`;
    locked = lockResult?.locked === true;
    if (!locked) return;

    await connection`
      INSERT INTO background_job_status (job_name, status, heartbeat_at, last_started_at)
      VALUES (${JOB_NAME}, 'running', now(), now())
      ON CONFLICT (job_name) DO UPDATE SET
        status = 'running',
        heartbeat_at = now(),
        last_started_at = now(),
        updated_at = now()
    `;

    const [chatResult] = await connection`SELECT * FROM provision_chat_operational_reminders(NULL, NULL, NULL)`;
    const [notificationResult] = await connection`SELECT * FROM provision_operational_notifications(NULL)`;
    const safeResult = {
      ...parseReminderWorkerResult(chatResult),
      ...parseOperationalNotificationResult(notificationResult),
    };

    await connection`
      UPDATE background_job_status SET
        status = 'succeeded',
        heartbeat_at = now(),
        last_succeeded_at = now(),
        last_error_code = NULL,
        last_result = ${connection.json(safeResult)},
        updated_at = now()
      WHERE job_name = ${JOB_NAME}
    `;
    console.log(JSON.stringify({ operation: "reminder_worker.cycle", status: "succeeded", ...safeResult }));
  } catch (error) {
    const errorCode = safeCliErrorCode(error, "REMINDER_WORKER_FAILED");
    try {
      await connection`
        INSERT INTO background_job_status (
          job_name, status, heartbeat_at, last_started_at, last_failed_at, last_error_code
        ) VALUES (${JOB_NAME}, 'failed', now(), now(), now(), ${errorCode})
        ON CONFLICT (job_name) DO UPDATE SET
          status = 'failed',
          heartbeat_at = now(),
          last_failed_at = now(),
          last_error_code = ${errorCode},
          updated_at = now()
      `;
    } catch {
      // The original database error is the actionable failure; a second log would only add noise.
    }
    console.error(JSON.stringify({ operation: "reminder_worker.cycle", status: "failed", errorCode }));
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(hashtext(${JOB_NAME}))`;
    connection.release();
  }
}

async function main() {
  if (process.argv.includes("--healthcheck")) {
    try {
      await checkHealth();
    } finally {
      await sql.end();
    }
    return;
  }

  let stopping = false;
  let wakeTimer;
  let wakeWorker;
  const stop = () => {
    stopping = true;
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeWorker?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    await runCycle();
    if (stopping) break;
    await new Promise((resolve) => {
      wakeWorker = resolve;
      wakeTimer = setTimeout(resolve, intervalMs);
    });
    wakeTimer = undefined;
    wakeWorker = undefined;
  }

  await sql.end({ timeout: 5 });
}

await main();
