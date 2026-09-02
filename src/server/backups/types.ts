export type BackupRunStatus = "running" | "succeeded" | "failed";

export type BackupRunListItem = {
  id: string;
  status: BackupRunStatus;
  archiveName: string | null;
  databaseBytes: number | null;
  documentsBytes: number | null;
  startedAt: string;
  completedAt: string | null;
  restoreVerifiedAt: string | null;
  failureCode: string | null;
};

export type BackupSystemSnapshot = {
  workerStatus: "not_started" | "running" | "succeeded" | "failed" | "stale";
  heartbeatAt: string | null;
  lastSucceededAt: string | null;
  policy: {
    backupIntervalMs: number;
    retryIntervalMs: number;
    retentionDays: number;
  } | null;
  runs: BackupRunListItem[];
};
