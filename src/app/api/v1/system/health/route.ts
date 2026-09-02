import { getDatabase } from "@/server/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const workers = await getDatabase()`SELECT job_name,
      CASE
        WHEN heartbeat_at IS NULL THEN 'not_started'
        WHEN heartbeat_at > now() - interval '5 minutes' THEN 'available'
        ELSE 'stale'
      END AS status
      FROM background_job_status
      WHERE job_name IN ('chat.visit-reminders', 'system.backup')`;
    const workerStatus = new Map(workers.map((worker) => [worker.job_name, worker.status]));
    return Response.json({
      status: "ok",
      service: "crm-web",
      apiVersion: "v1",
      database: "available",
      reminderWorker: workerStatus.get("chat.visit-reminders") ?? "not_started",
      backupWorker: workerStatus.get("system.backup") ?? "not_started",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(JSON.stringify({ operation: "system.health", category: "database_unavailable", error: error instanceof Error ? error.message : "Unknown error" }));
    return Response.json({ status: "unavailable", service: "crm-web", database: "unavailable" }, { status: 503 });
  }
}
