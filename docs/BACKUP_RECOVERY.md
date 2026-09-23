# Backup verification and recovery gaps

Status: partial P0.3 implementation, reviewed 2026-09-20. This is a verification
runbook, not the complete disaster-recovery procedure or a production RPO/RTO commitment.

The worker also supports the explicit S3 backend: it stages checksum-verified objects
under the same locked PostgreSQL snapshot before creating the existing archive format.
The isolated S3 worker test restores a full database plus all four file families and
rejects a missing remote object even when matching local bytes exist. This does not
yet migrate the working installation or provide an S3 rehydration/rollback command.
See [object storage](OBJECT_STORAGE.md) and `npm run test:s3-backup`.

## What a successful verification means

The verifier checks the exact three-member SHA-256 manifest (`database.dump`,
`documents.tar.gz`, `metadata.json`). Duplicate or unexpected manifest entries,
linked members, unsafe tar paths, duplicate paths, links and special archive entries
are rejected. Tar paths are limited to the application's generated storage layout.
An archive listing exceeding the current capture limit fails explicitly; a truncated
listing is never accepted. Streaming support for very large inventories remains future work.

The database dump is restored to a newly generated `crm_restore_check_*` database.
The documents archive is extracted into a new private temporary directory. The check
requires the core tables, migration history and all four file-reference tables. It
streams every retained reference, including historical document/template versions and
attachments of soft-deleted messages, and validates:

- the storage key belongs to the recorded organization;
- the path contains real directories and a regular, unlinked file;
- the file size matches the database and is within the application file-size limit;
- the complete file's SHA-256 matches the database reference.

Results include `verifiedFileCounts`, `verifiedFileBytes`, `migrationCount` and
`restoreDurationMs`. Duration includes archive checks, restore, file verification and
cleanup, but excludes incident detection, retrieving an offsite copy and bringing the
application back online. It is **not** total recovery time. Temporary files/databases
are removed on success and failure; cleanup failures are reported, not swallowed.

The worker persists these results in `background_job_status.last_result`. It exports
only after restore verification. A restore or retention failure leaves the run/job
failed; `--run-once` returns a nonzero code. A run skipped because it is not due or
another worker holds the lock does not constitute a new successful backup.

## Rehearse on an independent PostgreSQL instance

Use a disposable PostgreSQL 17 instance, a matching PostgreSQL client, Node.js and
the supported runtime image's tar implementation. Never set the destination to the
working database server for this rehearsal. Provision the destination independently;
the verifier needs permission to create/drop its temporary databases.

Only use a trusted application backup from a protected archive location. A checksum
manifest detects corruption, not authenticity. PostgreSQL dumps can execute SQL chosen
by their source administrators; a random database name does not sandbox that code.
See the [PostgreSQL restore warning](https://www.postgresql.org/docs/17/app-pgrestore.html).

1. Mount/copy the selected backup read-only into the verification environment. Do not
   alter the original or overwrite the working database/storage.
2. Set `BACKUP_RESTORE_TEST_URL` to the isolated server's admin database URL,
   `BACKUP_ARCHIVE_ROOT` to the directory holding archives and `BACKUP_ARCHIVE_NAME`
   to the exact selected timestamp/random-suffix directory name. Keep credentials
   out of command history/logs.
3. From the repository with dependencies and PostgreSQL tools installed, run:

   ```sh
   DATABASE_URL="$BACKUP_RESTORE_TEST_URL" BACKUP_ROOT="$BACKUP_ARCHIVE_ROOT" \
     node scripts/backup-restore-check.mjs --verify-only --archive="$BACKUP_ARCHIVE_NAME"
   ```

   `--verify-only` does not update the source's backup history and does not require
   a `backup_runs` table in the isolated admin database. Without this flag the legacy
   same-server command updates the successful run's `restore_verified_at`.
4. Require exit code 0 and a `backup.restore_check` success record. Retain the archive
   name, image digest, counts/bytes and measured duration as evidence. A failure means
   the copy is not accepted; do not replace the working installation with it.
5. Confirm cleanup. If cleanup fails, inspect the reported temporary resource before
   manual removal; never remove a broad database/storage directory to recover a drill.

Archives predating the required file-reference tables are not silently accepted by the
current verifier; they need a compatible historical restore/upgrade rehearsal.

## Coherent database/file snapshots (archive format 2)

The creator takes SHARE locks on the four file-reference tables before the first
snapshot read. It exports a PostgreSQL REPEATABLE READ snapshot and copies only its
referenced files into private staging, checking source and staged size/SHA-256.
Historical references remain included; orphaned and uncommitted files are excluded.
An independent read-only transaction imports and re-exports that same snapshot.
After staging, the locking transaction commits, so file-reference writes can resume
**before** `pg_dump --snapshot` starts. Tar reads staging, never the changing live directory.
The creator records `recoveryPointAt`, snapshot file counts/bytes and measured
`fileLockDurationMs`; the worker also persists the recovery point and copy budget.

This relies on the application's immutable-file lifecycle: exclusive file creation,
reference commit only after a complete write, and deletion only after removing or
replacing the reference. Manual filesystem mutation and concurrent schema migrations
are not supported backup workflows. Checksum failures reject the copy rather than
substituting missing files. Keep schema deployments separate from backup windows.

During staging, transactions that change these four tables can wait; normal reads and
unrelated writes remain available. Lock acquisition has a 5-second PostgreSQL timeout.
`BACKUP_SNAPSHOT_COPY_TIMEOUT_MS` defaults to 30,000 (allowed 1,000–120,000); the copy
budget is checked between/after files and also bounds the locking session's idle
transaction time. It is not a hard cancellation deadline for a stuck filesystem call.
`pg_dump` has a 240-second process deadline; other backup subprocesses default to 300
seconds. Deadline/output-limit termination escalates from SIGTERM to SIGKILL after one
second, and even a process exiting zero after termination is reported as failed.
The read-only snapshot keeper has a 420-second idle timeout. Failures close both
database sessions; cleanup failures preserve the original error alongside cleanup errors.

Staging requires additional temporary disk space equal to the referenced files,
besides the final dump/archive. Representative-volume copy-time/disk-budget acceptance
is still pending. A timeout fails the backup; it does not silently switch to an
inconsistent snapshot. Format-1 historical archives are still readable but do not
gain a shared recovery-point guarantee retroactively.

## Automated checks

`npm test` includes archive/file integrity unit tests. `npm run test:backup-restore`
starts and removes its own PostgreSQL 17 container. Set `BACKUP_RESTORE_TEST_IMAGE`
to a built CRM runtime image to run the integration in Docker; without an image,
the host needs `pg_dump`, `pg_restore` and `tar`. The packaged path runs as the
non-root runtime user and also injects a permission failure into retention cleanup.

The CI `backup-recovery` job builds the runtime image and tests its packaged scripts,
not replacements mounted over the implementation. Only the test script is mounted.
It covers a full migrated schema, historical versions, each missing/corrupt file family,
real tar links, worker success/failure, CLI exit codes, independent verification and
cleanup. Remote GitHub execution is not yet verified.
Snapshot checks hold a real writer lock, observe the backup waiting, commit the
writer, replace/delete a live avatar after staging, and restore the retained old
reference successfully. They check pre-snapshot writes are included, later writes
are excluded, reads/unrelated writes continue, no orphan/new file enters staging,
and dump/staging/lock failures release the snapshot sessions.

Before publishing a host export, the worker now checks the exact
four-member archive, verifies each copied file against `manifest.sha256`, and
confirms the copied manifest matches the source. A failed copy stays in a
temporary directory and is removed; the export timestamp is recorded only
after the verified directory is renamed into place. This does not yet prove
delivery to an independent offsite destination.

## Remaining production requirements

- Representative-volume acceptance of the coordinated snapshot: staging disk space,
  copy budget, and file-write latency while the four reference tables are locked.
- Safe reconciliation of files retained after unknown transaction outcomes. The nine
  upload paths now preserve committed bytes after refresh failure and retain evidence
  when COMMIT cannot be confirmed. Installed web image `30f73d3a9449` includes guards
  for documents/versions, receipts, closing acts/photos, templates, chat attachments
  and avatars. Action tests, 27 real PostgreSQL/file scenarios (including dropped
  COMMIT acknowledgements) and 18 browser submissions pass; nine substituted warning
  states verify UI retention, not backend faults. See `PRODUCTION_PROGRESS.md`.
  Ownership checks prevent an EEXIST request from deleting another request's file.
  Reconciliation must coordinate with writers: age or absence from a database snapshot
  alone does not establish that a file is safe to remove. No automatic orphan cleanup
  has been enabled. Snapshot verification rejects missing files but cannot repair a
  damaged source reference.
  The read-only [storage inventory](STORAGE_RECONCILIATION.md) now reports referenced
  integrity failures and unreferenced/unexpected entries without deleting anything.
  A clean inventory is neither a backup nor proof that later cleanup is safe.
- Encryption, independent authenticated off-host storage, key rotation and recovery.
  A bind-mounted host export remains on the same failure domain.
- Daily/weekly/monthly retention, protection of known-good recovery points and disk budgets.
- Scheduled independent restore drills and backup-freshness alerts. The existing
  worker healthcheck is a heartbeat check, not proof of a fresh backup.
- Complete restoration/cutover/rollback runbook, document business-flow checks after
  recovery, agreed RPO/RTO and representative-volume measurements.

No purchase of a server or domain is needed for the local correctness tests above.
