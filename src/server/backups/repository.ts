import "server-only";
import { z } from "zod";
import { requirePermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";
import type { BackupRunListItem, BackupSystemSnapshot } from "./types";

const backupRunRowSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["running", "succeeded", "failed"]),
  archive_name: z.string().nullable(),
  database_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number).nullable(),
  documents_bytes: z.union([z.string(), z.bigint(), z.number()]).transform(Number).nullable(),
  started_at: z.coerce.date(),
  completed_at: z.coerce.date().nullable(),
  restore_verified_at: z.coerce.date().nullable(),
  failure_code: z.string().nullable(),
});

const workerRowSchema = z.object({
  status: z.enum(["running", "succeeded", "failed"]),
  heartbeat_at: z.coerce.date(),
  last_succeeded_at: z.coerce.date().nullable(),
  stale: z.boolean(),
  backup_interval_ms: z.string().regex(/^\d+$/).transform(Number).nullable(),
  retry_interval_ms: z.string().regex(/^\d+$/).transform(Number).nullable(),
  retention_days: z.string().regex(/^\d+$/).transform(Number).nullable(),
  host_export_enabled: z.enum(["true", "false"]).transform((value) => value === "true").nullable(),
  host_exported_at: z.string().datetime().nullable(),
}).nullable();

function mapBackupRun(value: unknown): BackupRunListItem {
  const row = backupRunRowSchema.parse(value);
  return {
    id: row.id,
    status: row.status,
    archiveName: row.archive_name,
    databaseBytes: row.database_bytes,
    documentsBytes: row.documents_bytes,
    startedAt: row.started_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    restoreVerifiedAt: row.restore_verified_at?.toISOString() ?? null,
    failureCode: row.failure_code,
  };
}

export async function getBackupSystemSnapshot(member: AuthenticatedMember): Promise<BackupSystemSnapshot> {
  requirePermission(member, "settings.write");
  const sql = getDatabase();
  const [workerRows, runRows] = await Promise.all([
    sql`SELECT status, heartbeat_at, last_succeeded_at,
        last_result->>'backupIntervalMs' AS backup_interval_ms,
        last_result->>'retryIntervalMs' AS retry_interval_ms,
        last_result->>'retentionDays' AS retention_days,
        last_result->>'hostExportEnabled' AS host_export_enabled,
        last_result->>'hostExportedAt' AS host_exported_at,
        heartbeat_at <= now() - interval '5 minutes' AS stale
      FROM background_job_status WHERE job_name = 'system.backup'`,
    sql`SELECT id, status, archive_name, database_bytes, documents_bytes,
        started_at, completed_at, restore_verified_at, failure_code
      FROM backup_runs ORDER BY started_at DESC LIMIT 12`,
  ]);
  const worker = workerRowSchema.parse(workerRows[0] ?? null);
  return {
    workerStatus: worker === null ? "not_started" : worker.stale ? "stale" : worker.status,
    heartbeatAt: worker?.heartbeat_at.toISOString() ?? null,
    lastSucceededAt: worker?.last_succeeded_at?.toISOString() ?? null,
    policy: worker?.backup_interval_ms && worker.retry_interval_ms && worker.retention_days ? {
      backupIntervalMs: worker.backup_interval_ms,
      retryIntervalMs: worker.retry_interval_ms,
      retentionDays: worker.retention_days,
    } : null,
    storage: {
      protectedVolume: true,
      hostExportEnabled: worker?.host_export_enabled ?? false,
      hostExportedAt: worker?.host_exported_at ?? null,
    },
    runs: runRows.map(mapBackupRun),
  };
}

export function getPreviewBackupSystemSnapshot(): BackupSystemSnapshot {
  return { workerStatus: "not_started", heartbeatAt: null, lastSucceededAt: null, policy: null, storage: { protectedVolume: true, hostExportEnabled: false, hostExportedAt: null }, runs: [] };
}
