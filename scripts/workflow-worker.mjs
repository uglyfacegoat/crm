import postgres from "postgres";
import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { processWorkflowJobs } from "../src/server/workflow/worker-engine.ts";

const JOB_NAME = "workflow.order-created";
function invalidConfig(field) {
  console.error(JSON.stringify({ operation: "workflow_worker.main", status: "failed",
    errorCode: "WORKFLOW_WORKER_CONFIG_INVALID", field }));
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL;
let parsedUrl;
try { parsedUrl = new URL(databaseUrl); } catch { invalidConfig("DATABASE_URL"); }
if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol) || !parsedUrl.hostname
  || !parsedUrl.username || parsedUrl.pathname.length < 2) invalidConfig("DATABASE_URL");
const intervalMs = Number(process.env.WORKFLOW_WORKER_INTERVAL_MS ?? 5_000);
if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
  invalidConfig("WORKFLOW_WORKER_INTERVAL_MS");
}
const sql = postgres(databaseUrl, { max: 2, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined });

async function healthcheck() {
  const [row] = await sql`SELECT heartbeat_at > now() - interval '2 minutes' AS healthy
    FROM background_job_status WHERE job_name = ${JOB_NAME}`;
  if (row?.healthy !== true) process.exitCode = 1;
}

async function cycle() {
  await sql`INSERT INTO background_job_status (job_name, status, heartbeat_at, last_started_at)
    VALUES (${JOB_NAME}, 'running', now(), now())
    ON CONFLICT (job_name) DO UPDATE SET status = 'running', heartbeat_at = now(),
      last_started_at = now(), updated_at = now()`;
  try {
    const result = await processWorkflowJobs(sql, 10);
    await sql`UPDATE background_job_status SET status = 'succeeded', heartbeat_at = now(),
      last_succeeded_at = now(), last_error_code = NULL, last_result = ${sql.json(result)}, updated_at = now()
      WHERE job_name = ${JOB_NAME}`;
    if (result.succeeded || result.failed || result.stopped) {
      console.log(JSON.stringify({ operation: "workflow_worker.cycle", status: "succeeded", ...result }));
    }
  } catch (error) {
    const errorCode = safeCliErrorCode(error, "WORKFLOW_WORKER_FAILED");
    await sql`UPDATE background_job_status SET status = 'failed', heartbeat_at = now(),
      last_failed_at = now(), last_error_code = ${errorCode}, updated_at = now()
      WHERE job_name = ${JOB_NAME}`;
    console.error(JSON.stringify({ operation: "workflow_worker.cycle", status: "failed", errorCode }));
  }
}

let stopping = false;
let timer;
let wake;
const stop = () => { stopping = true; if (timer) clearTimeout(timer); wake?.(); };
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  if (process.argv.includes("--healthcheck")) await healthcheck();
  else if (process.argv.includes("--once")) await cycle();
  else while (!stopping) {
    await cycle();
    if (stopping) break;
    await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, intervalMs); });
    timer = undefined;
    wake = undefined;
  }
} catch (error) {
  console.error(JSON.stringify({ operation: "workflow_worker.main", status: "failed",
    errorCode: safeCliErrorCode(error, "WORKFLOW_WORKER_FAILED") }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
