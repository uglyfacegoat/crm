import { safeCliErrorCode } from "./safe-cli-error.mjs";
import { lstat, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { BACKUP_FILE_TABLES, STORAGE_KEY, validateFileReference, verifyRestoredFile } from "./backup-integrity.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";

const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Diagnostic only: a file absent from this snapshot may belong to an in-flight upload.
export async function auditStorage({ sql, storageRoot, objectStorage, onRecord }) {
  if (!objectStorage) {
    if (!isAbsolute(storageRoot) || resolve(storageRoot) === "/") throw new Error("An explicit storage directory is required.");
    if (!(await lstat(storageRoot)).isDirectory()) throw new Error("Storage root must be a real directory, not a link.");
  }
  const summary = {
    event: "storage.audit.complete", snapshotAt: null, referenceCounts: {},
    verifiedReferences: 0, verifiedReferenceBytes: 0, integrityFailures: 0,
    scannedFiles: 0, scannedBytes: 0, unreferencedFiles: 0, unreferencedBytes: 0, unexpectedEntries: 0,
    ...(objectStorage ? {
      backend: "s3", bucketVersioning: await objectStorage.versioning(),
      scannedVersions: 0, scannedVersionBytes: 0, noncurrentVersions: 0,
      unreferencedVersions: 0, deleteMarkers: 0, currentDeleteMarkers: 0,
    } : { backend: "local" }),
  };
  await sql.begin("isolation level repeatable read read only", async (transaction) => {
    await transaction`SET LOCAL statement_timeout = '30s'`;
    await transaction`SET LOCAL idle_in_transaction_session_timeout = '60s'`;
    const [snapshot] = await transaction`SELECT clock_timestamp() AS captured_at`;
    summary.snapshotAt = snapshot.captured_at.toISOString();
    await onRecord({ event: "storage.audit.started", snapshotAt: summary.snapshotAt, mode: "read-only", backend: summary.backend,
      safeToDelete: false, storageIsAtomicSnapshot: false });
    for (const table of BACKUP_FILE_TABLES) {
      summary.referenceCounts[table] = 0;
      for await (const references of transaction`SELECT organization_id, storage_key, size_bytes, sha256 FROM ${transaction(table)}`.cursor(100)) {
        for (const reference of references) {
          summary.referenceCounts[table] += 1;
          try {
            if (objectStorage) {
              const expected = validateFileReference(reference);
              const bytes = await objectStorage.readVerified(expected.storageKey, expected, 15 * 1024 * 1024);
              summary.verifiedReferenceBytes += bytes.length;
            } else {
              summary.verifiedReferenceBytes += await verifyRestoredFile(storageRoot, reference);
            }
            summary.verifiedReferences += 1;
          } catch (error) {
            if (objectStorage && ["EACCES", "ESTORAGE", "ETIMEDOUT"].includes(error.code)) throw error;
            summary.integrityFailures += 1;
            await onRecord({ event: "storage.audit.reference_invalid", table, storageKey: reference.storage_key,
              reason: error.code === "ENOENT" ? "missing" : "integrity_or_read_failure" });
          }
        }
      }
    }

    async function* remoteEntries() {
      for await (const entry of objectStorage.inventory()) {
        if (!STORAGE_KEY.test(entry.storageKey) || !IDENTIFIER.test(entry.storageKey.split("/")[0])) {
          summary.unexpectedEntries += 1;
          // Arbitrary bucket keys may contain personal data or secrets; do not echo them into logs.
          await onRecord({ event: "storage.audit.unexpected_object", keyHash: createHash("sha256").update(entry.storageKey).digest("hex"),
            kind: entry.kind, safeToDelete: false });
          continue;
        }
        yield entry;
      }
    }

    async function* walk(segments = []) {
      const directory = await opendir(join(storageRoot, ...segments));
      for await (const entry of directory) {
        const child = [...segments, entry.name];
        const relativePath = child.join("/");
        const stat = await lstat(join(storageRoot, ...child));
        if (child.length < 3 && IDENTIFIER.test(entry.name) && stat.isDirectory()) {
          yield* walk(child);
        } else if (child.length === 3 && STORAGE_KEY.test(relativePath) && stat.isFile() && stat.nlink === 1) {
          yield { storageKey: relativePath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
        } else {
          summary.unexpectedEntries += 1;
          await onRecord({ event: "storage.audit.unexpected_entry", path: relativePath });
        }
      }
    }

    async function checkBatch(files) {
      const referenced = new Set();
      // Group by tenant so the existing (organization_id, storage_key) indexes apply.
      const byOrganization = Map.groupBy(files, (file) => file.storageKey.split("/")[0]);
      for (const [organizationId, entries] of byOrganization) {
        const keys = entries.map((file) => file.storageKey);
        for (const table of BACKUP_FILE_TABLES) {
          const matches = await transaction`SELECT storage_key FROM ${transaction(table)}
            WHERE organization_id = ${organizationId}::uuid AND storage_key = ANY(${keys}::text[])`;
          for (const match of matches) referenced.add(match.storage_key);
        }
      }
      for (const file of files) {
        const referencedInSnapshot = referenced.has(file.storageKey);
        if (objectStorage) {
          if (file.kind === "delete-marker") {
            summary.deleteMarkers += 1;
            if (file.isLatest) summary.currentDeleteMarkers += 1;
            await onRecord({ event: "storage.audit.delete_marker", ...file, referencedInSnapshot, safeToDelete: false });
            continue;
          }
          summary.scannedVersions += 1;
          summary.scannedVersionBytes += file.sizeBytes;
          if (!referencedInSnapshot) summary.unreferencedVersions += 1;
          if (!file.isLatest) {
            summary.noncurrentVersions += 1;
            await onRecord({ event: "storage.audit.noncurrent_version", ...file, referencedInSnapshot,
              contentVerified: false, safeToDelete: false });
            continue;
          }
        }
        summary.scannedFiles += 1;
        summary.scannedBytes += file.sizeBytes;
        if (referencedInSnapshot) continue;
        summary.unreferencedFiles += 1;
        summary.unreferencedBytes += file.sizeBytes;
        await onRecord({ event: "storage.audit.unreferenced_in_snapshot", ...file, safeToDelete: false });
      }
    }
    let batch = [];
    for await (const file of objectStorage ? remoteEntries() : walk()) {
      batch.push(file);
      if (batch.length === 100) { await checkBatch(batch); batch = []; }
    }
    if (batch.length) await checkBatch(batch);
    if (objectStorage && await objectStorage.versioning() !== summary.bucketVersioning) {
      throw new Error("Bucket versioning changed during the audit; repeat after configuration stabilizes.");
    }
  });
  summary.hasFindings = Boolean(summary.integrityFailures || summary.unreferencedFiles || summary.unexpectedEntries || summary.unreferencedVersions);
  summary.safeToDelete = false;
  await onRecord(summary);
  return summary;
}

async function main() {
  const backend = storageBackend(process.env);
  if (process.argv.slice(2).join(" ") !== "--check" || !process.env.DATABASE_URL
    || (backend === "local" && !process.env.DOCUMENT_STORAGE_ROOT)) {
    throw new Error("Use --check with DATABASE_URL and the selected storage backend configured.");
  }
  const objectStorage = backend === "s3" ? createS3AuditStorage(process.env) : undefined;
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, onnotice: () => {},
    connection: { application_name: "crm_storage_audit", default_transaction_read_only: "on" } });
  try {
    const result = await auditStorage({ sql, storageRoot: process.env.DOCUMENT_STORAGE_ROOT, objectStorage,
      onRecord: (record) => new Promise((done, reject) => {
        process.stdout.write(`${JSON.stringify(record)}\n`, (error) => error ? reject(error) : done());
      }) });
    if (result.hasFindings) process.exitCode = 2;
  } finally {
    objectStorage?.close();
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    console.error(JSON.stringify({ event: "storage.audit.failed", code: safeCliErrorCode(error, "AUDIT_FAILED") }));
    process.exitCode = 1;
  }
}
