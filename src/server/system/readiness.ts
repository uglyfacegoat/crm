import "server-only";
import { getDatabase } from "@/server/database";
import { checkDocumentStorageAvailability } from "@/server/documents/storage";

const headers = { "cache-control": "no-store" };

export async function readinessResponse() {
  const [database, storage] = await Promise.allSettled([
    Promise.resolve().then(() => getDatabase()`SELECT job_name,
      CASE
        WHEN heartbeat_at IS NULL THEN 'not_started'
        WHEN heartbeat_at > now() - interval '5 minutes' THEN 'available'
        ELSE 'stale'
      END AS status
      FROM background_job_status
      WHERE job_name IN ('chat.visit-reminders', 'system.backup')`),
    Promise.resolve().then(checkDocumentStorageAvailability),
  ]);
  if (database.status === "rejected") console.error(JSON.stringify({ operation: "system.readiness", category: "database_unavailable" }));
  if (storage.status === "rejected") console.error(JSON.stringify({ operation: "system.readiness", category: "storage_unavailable" }));
  const databaseState = database.status === "fulfilled" ? "available" : "unavailable";
  const storageState = storage.status === "fulfilled" ? "available" : "unavailable";
  if (database.status !== "fulfilled" || storage.status !== "fulfilled") {
    return Response.json({ status: "unavailable", service: "crm-web", database: databaseState, storage: storageState }, { status: 503, headers });
  }
  const workerStatus = new Map(database.value.map((worker) => [worker.job_name, worker.status]));
  return Response.json({
    status: "ok",
    service: "crm-web",
    apiVersion: "v1",
    database: databaseState,
    storage: storageState,
    reminderWorker: workerStatus.get("chat.visit-reminders") ?? "not_started",
    backupWorker: workerStatus.get("system.backup") ?? "not_started",
    checkedAt: new Date().toISOString(),
  }, { headers });
}
