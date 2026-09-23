# File write drain and recovery — source candidate

The implementation added on 2026-09-23 is **not installed in the working CRM**.
FS-02/03 remain open. Do not switch storage or clear unresolved operations on the
strength of the tests below alone.

`db/migrations/056_file_write_control.sql` creates a persistent accepting flag
and one row per started file operation. The file adapter records each intended
storage key in that row before writing bytes; the local example seed does the
same. A recorded key does not prove that the bytes were written or committed.
Each of the nine interactive upload
paths, plus the local example seed, acquires a PostgreSQL shared advisory lock, checks the flag, inserts its
operation row, and holds the lock through file I/O, business commit or rollback,
and owned-file cleanup. When an action cannot confirm persistence, or owned-file
cleanup fails, it marks the attempt uncertain; the durable row is retained
after the lease unlocks and later blocks a false successful drain. A normal
confirmed commit or completed rollback removes its row. A paused upload receives a specific user-facing error
before writing bytes. Text-only chat and finance operations without receipts
continue. The gate uses a separate bounded pool so an operation cannot consume
all connections needed for its own business transaction.

The operator command `node scripts/file-write-drain.mjs pause` persists
`accepting=false` and waits for current advisory-lock holders. It reports
`drained=true` only after locks have left **and** the durable operation table
is empty. A process crash or DB connection loss may release an advisory lock
while work has no confirmed outcome; its operation row remains. `resume`
refuses while any such row exists. `status` reports the current flag and count.
After `pause`, `inspect` takes the exclusive lock and lists up to 100
unresolved operation IDs, start times and intended storage keys. If
`nextCursor` is non-null, pass it as the next argument to `inspect` and repeat
until `nextCursor` is null. It refuses inspection while writes are accepted.
An empty key list can mean interruption before the first file attempt; a key
does not prove a file exists or is safe to remove.
The command must use the target environment's `DATABASE_URL`; its pause mode
returns exit code 2 when unresolved operations remain. No drain command automatically
deletes those rows.

On an isolated PostgreSQL 17 database, `npm run test:file-drain` verifies that
pause waits for two concurrent operations, rejects a new write and the local
example seed, persists across new
connections, rejects a writer started in a fresh process while paused, and
remains undrained after a process crash or termination of
the lease's database connection. A handled unknown outcome also retains its
row and blocks `resume`. It pages through 101 unresolved rows
without silently omitting the final record. The existing action tests cover a user-facing
pause response before storage I/O, and the receipt integration suite still
covers actual database commits and lost COMMIT acknowledgements; all nine
file-action paths now assert a durable unresolved key after a lost COMMIT.
Source action tests also cover failed rollback cleanup. The new test
is included in CI configuration; remote CI execution has not been observed.
The earlier keyed production image was started with all 56 migrations on a disposable
PostgreSQL database. Its HTTP health endpoint and packaged
`status`/`pause`/`inspect`/`resume` commands passed. The disposable database was
removed; the working CRM database still has 55 migrations. The newer candidate
image applied all 57 migrations on another disposable database, passed HTTP
health, and ran packaged pause/review/resolve/retry/resume against a zero-key
interrupted operation. It verified one immutable resolution record. That
database and container were removed; the working CRM was not upgraded.
The standalone browser suite passed against disposable local and S3 storage:
18 real submissions and nine injected warning states in each mode. It also
paused writes and confirmed the document dialog showed the pause message
without creating a file or database reference. The local standalone harness
requires `.next/static` and `public` copied beside `server.js`, as in the
production Dockerfile. This is not an installed working-CRM browser check.

## Unresolved-operation investigation

1. Keep the persistent pause in place. Stop every application process that can
   write business files, including web instances, seed jobs and any one-off
   scripts. A lost database lease alone does not prove its process stopped.
2. Run `node scripts/file-write-drain.mjs inspect` against the paused database.
   Record all IDs, timestamps and keys. If the response has `nextCursor`, run
   `node scripts/file-write-drain.mjs inspect <nextCursor>` for the next page;
   continue until it is null. Keep all writers stopped and do not clear rows
   during pagination; rerun from the start if the pending count changes.
3. With storage frozen, run the read-only `storage-audit.mjs --check` and retain
   its complete private report. Check all four reference families, the actual
   file bytes/checksums, and any unreferenced or unexpected entries. Match
   each recorded key with the inventory and committed references; neither a
   matching key nor a clean audit alone establishes the interrupted outcome.
4. Establish the outcome of **each** interrupted request from application and
   database evidence. Preserve unknown files and backup material. For local or
   S3 storage, the command below can resolve a key whose current bytes match
   a committed reference, one absent from both storage and references, or a
   local key moved into a verified quarantine by the candidate below.
   If ownership/outcome is uncertain, leave the row and pause in place.
5. Only after all rows are accounted for, rerun the audit and `inspect`. Resume
   only when `pending=0` and the operator has confirmed the storage state.

## Audited resolution candidate

Only use this after every writer process has been stopped and a complete
private `storage-audit.mjs --check` report retained.
The tool cannot itself prove an external process has stopped or that storage
is frozen. S3 review also inventories all object versions and delete markers
for the operation's keys; any remaining version of an unreferenced key blocks
resolution, even when its latest state is a delete marker. A referenced
write-once key with more than one object version or a delete marker also blocks
resolution, even when the current bytes match the database row. The review hash
includes the backend, bucket versioning state and version metadata digest.
The S3 path passed source integration tests and a packaged-runtime smoke on a
disposable database/bucket: the CLI rejected an unreferenced current object.
That smoke did not cover every S3 resolution outcome. Work under a restricted
operator account with `umask 077`; keep reports and evidence outside the
document-storage tree.

1. Run `node scripts/file-write-recovery.mjs review <operation-id>`. It takes
   the exclusive file-write lock, requires the persistent pause, checks all
   four reference tables, verifies referenced local or S3 bytes, and reports whether
   each recorded key is `referenced_verified`, `absent_unreferenced`,
   `unreferenced_present`, `reference_invalid`, or `unexpected_path`. Retain
   the complete JSON report and its `reviewSha256`. Review exits 2 if a key
   cannot be resolved by this command.
2. Independently document the writer stop, application outcome, storage audit,
   matching references and any backup/quarantine decision in a private regular
   evidence file. Obtain the case ID and operator review. The tool hashes the
   file but does not validate the truth of its contents.
3. For a fully reviewed operation only, run
   `node scripts/file-write-recovery.mjs resolve <operation-id> <reviewSha256> <case-id> <absolute-evidence-file> <operator-name>`.
   It repeats the same checks under the exclusive lock and a database snapshot.
   If the state changed, the hash differs and it refuses. A successful command
   atomically removes only that operation row and inserts an append-only log
   with the full review, evidence hash, case ID, stated operator and database
   role. Retrying identical arguments after a lost response reports
   `alreadyResolved: true`; different evidence is rejected.

An unreferenced file, invalid reference or unexpected path blocks resolution.
For local files, the quarantine command below can preserve an unreferenced file
and make it eligible for a fresh review. S3 quarantine remains unimplemented.
The recovery command never moves or deletes storage bytes.
After all per-ID resolutions, rerun the full storage audit and `inspect` before
`resume`. The evidence file and raw review contain internal keys; do not place
them in public logs or the repository. A self-reported operator name does not
replace access control on the operator shell and database credentials.

## Local quarantine candidate

Migration 058 adds durable `prepared`/`complete` quarantine records. Choose a
private, absolute `FILE_WRITE_QUARANTINE_ROOT` outside
`DOCUMENT_STORAGE_ROOT` and back up its contents separately. In Docker,
mount this path on a persistent private volume before starting the container;
the image deliberately does not create an ephemeral quarantine directory.
Set both variables and `DATABASE_URL` in the operator environment. After stopping writers,
persisting `pause`, confirming the key is unreferenced, and recording a case ID:

```sh
node scripts/file-write-quarantine.mjs <operation-id> <storage-key> <case-id> <operator-name>
```

The command checks all four reference tables and records the source size/hash
before copying. It creates a new destination without replacing an existing
file, verifies and syncs the copy, rechecks the source and references, then
unlinks only the original unreferenced path. The operation row remains pending.
An interruption leaves a durable `prepared` record; rerun the **same** command
with the same case/operator to complete it. If the copy or source changed,
the command stops without accepting it. A completed quarantine record cannot
be updated or deleted by the application role.

Now rerun `file-write-recovery.mjs review` with
`FILE_WRITE_QUARANTINE_ROOT` set. It verifies the quarantined bytes and reports
`quarantined_verified`; a missing or corrupt copy reports
`quarantine_invalid` and blocks `resolve`. Use the quarantine's case ID for
resolution. The test suite interrupts before copy, after copy and after unlink,
then retries, and verifies referenced files are refused. The final packaged
image applied 58 migrations in a disposable database and passed HTTP health,
pause/quarantine/review/resolve/resume with a private Docker volume. The copy
remained readable after the container was removed. The candidate has not been
installed in the working CRM.

To retrieve bytes for a restore investigation, create a **different** private
directory outside both storage and quarantine, then run:

```sh
node scripts/file-write-quarantine-export.mjs <operation-id> <storage-key> <case-id> <absolute-export-root>
```

The command checks the completed manifest, case ID and current quarantine
checksum, creates a new private file without replacement, then rechecks its
checksum and syncs it. It never writes directly into live document storage or
changes a database reference. Review the exported bytes and business outcome
before deciding whether any manual restoration is appropriate. A full restore
drill and S3 quarantine remain open, as do retention decisions. A disposable
packaged runtime exported the verified bytes onto a second private Docker
volume; they remained readable after the container was removed. A separate
container-loss drill removed the app container after quarantine, started a new
one against the same disposable database and persistent quarantine volume,
then exported and verified the bytes again.

## S3 version export candidate

Migration 059 adds an append-only manifest record for a read-only S3 version
export. This is a preservation step, **not** S3 quarantine: the command never
deletes or changes an object and does not make an unreferenced key eligible for
manual resolution. Use a private, persistent `FILE_WRITE_S3_EXPORT_ROOT`
outside document storage and back it up separately. The production image does
not create this directory; mount a private volume before running the CLI.
After stopping writers and persisting `pause`, use an enabled-versioning bucket:

```sh
node scripts/file-write-s3-export.mjs <operation-id> <storage-key> <case-id> <operator-name>
```

The command inventories all versions of the recorded key, downloads every
object version by explicit version ID, verifies its listed size and SHA-256,
and records delete markers in the manifest. It writes private files without
replacement, syncs them, rechecks bucket versioning and the inventory, then
commits the manifest hash and operator case to the database. A retry accepts
only identical files, inventory, case and manifest. A partial or conflicting
copy stops for investigation; nothing is silently overwritten. A disposable
MinIO/PostgreSQL test covers two versions, a delete marker, repeat export,
wrong case, a changed inventory and append-only audit. The packaged image
also applied 59 migrations on a disposable database, archived two versions
and a delete marker onto a private Docker volume, and retained the bytes after
the app container was removed. Provider-specific acceptance and actual S3
quarantine remain open.

Before deployment and FS-02 acceptance, complete quarantine restore drills
and S3 quarantine. Confirm no other non-interactive business-file
writer bypasses the gate, rehearse interruption/restart and failure of
the lease connection, and verify browser messages in the installed build.
FS-03 additionally requires competitive uploads, process crash, connection
loss and restart acceptance. Never interpret `accepting=true` with zero active
rows as a drained state: new writes can begin immediately.
