# Storage reconciliation: read-only inventory

This is the diagnostic part of the storage lifecycle, not garbage collection or
completion of P0.6. Private object storage, content scanning, quotas, coordinated
cleanup and retention acceptance remain required.

## Run a check

Use the supported runtime image with `DATABASE_URL` and `DOCUMENT_STORAGE_ROOT`
explicitly configured. Run under a restricted operator account; this command is not
an HTTP endpoint. Prefer a read-only storage mount and a database login with SELECT
access to the four reference tables. No CREATE/UPDATE/DELETE privileges are needed.

```sh
node scripts/storage-audit.mjs --check
```

From a repository with dependencies installed, `npm run storage:audit` is equivalent.
Neither command loads an environment file automatically. Supply secrets through the
process environment; do not put connection URLs in shell history or reports.
Only `--check` is supported. Mutation flags are rejected.

The command emits JSON Lines, waiting for output writes rather than accumulating the
report in memory. Reports contain internal storage keys and unexpected path names;
keep them private, outside the document-storage directory. If redirecting output,
set restrictive file permissions first (for example, `umask 077`). Do not publish
raw reports in user-facing logs or support tickets.

Exit status:

- **0**: completed check with no findings.
- **2**: completed check with one or more findings; investigate, do not delete.
- **1**: incomplete/failed check. A partial report is not accepted, even if earlier
  records looked healthy. A database/schema/filesystem/output failure must be fixed
  before rerunning. Require both process status and the final `storage.audit.complete`
  record when consuming a report.

## Coverage and limits

The database is read in one REPEATABLE READ, READ ONLY transaction. All rows in
`document_versions`, `document_template_versions`, `chat_message_attachments` and
`chat_channel_avatars` are checked, including historical versions, inactive templates,
archived documents and attachments of soft-deleted messages. Referenced files must
match their organization, key, regular-file type, size and SHA-256. Missing/unreadable
files and checksum failures are explicit findings.

The directory walk stays within the generated three-level layout and does not follow
symlinks or descend into unexpected directories. Linked files and unexpected entries
are reported, not ignored. Directory entries and database references are streamed;
reference lookups use batches of at most 100 files and tenant-scoped indexes. PostgreSQL
statements have a 30-second timeout and idle transactions a 60-second timeout. These
are not a total wall-clock deadline or protection against a hung filesystem call.

Only the database has a consistent snapshot: this is **not** a coordinated backup
or frozen filesystem inventory. Concurrent replacements/removals can cause findings
or abort the walk. Repeat findings during a controlled maintenance window before
making a recovery decision. Do not manually rearrange the storage tree while checking.

`storage.audit.unreferenced_in_snapshot` means exactly that: no reference existed in
this database snapshot. A file may already be referenced by a newer committed
transaction, or belong to a still-pending upload. Every such record explicitly says
`safeToDelete: false`, regardless of file age. No unlink, rename, quarantine, metadata
repair or database mutation is performed by the checker.

## Acting on findings

1. **Invalid referenced file:** retain the report; identify the document/version or
   attachment from its key. Verify the last known-good backup independently. Do not
   remove its database row or replace it with empty bytes to silence the finding.
2. **Unexpected entry:** inspect the exact path with an authorized operator. The tool
   intentionally does not traverse arbitrary directories or follow links.
3. **Unreferenced file:** preserve it. An online inventory is not deletion authority.
   Compare with a fresh snapshot and the upload's actual outcome. If it became
   referenced, verify those bytes against the new reference.
4. **Failed check:** treat the inventory as incomplete; inspect database availability,
   permissions, filesystem health and output destination before retrying.

Automatic cleanup is deliberately not enabled. Its acceptance must include writer
drain/coordination covering file creation through reference commit, a fresh final
reference check, recoverable quarantine with an auditable manifest, and recovery
tests across crashes/restarts and concurrent uploads. A table lock alone is not enough:
a request can create a file before trying to insert its reference. Final removal also
needs an explicit retention policy rather than an invented age threshold.

## Regression evidence

`MIGRATION_TEST_ADMIN_URL` must target isolated PostgreSQL 17 with CREATEDB privileges:

```sh
npm run test:storage-audit
```

The suite installs all current migrations in a disposable database and creates real
files/references. It covers all four families, old versions/deleted parents, multiple
lookup batches, missing/corrupt files, links, output failure, CLI status/flags and a
reference committed by another connection after the snapshot begins. Test-only
files/databases are removed. CI runs the same tests against the packaged runtime
implementation; remote CI execution must still be verified separately.
