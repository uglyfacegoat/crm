# File write drain — source candidate

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
returns exit code 2 when unresolved operations remain. No command automatically
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
The keyed production image was started with all 56 migrations on a disposable
PostgreSQL database. Its HTTP health endpoint and packaged
`status`/`pause`/`inspect`/`resume` commands passed. The disposable database was
removed; the working CRM database still has 55 migrations.
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
   database evidence. Preserve unknown files and backup material. Any manual
   row resolution needs an operator-approved, per-ID record of the verified
   outcome and a separate recovery test; there is deliberately no bulk-clear
   command. If ownership/outcome is uncertain, leave the row and pause in place.
5. Only after all rows are accounted for, rerun the audit and `inspect`. Resume
   only when `pending=0` and the operator has confirmed the storage state.

No quarantine/removal automation is available yet. This procedure is a
diagnostic checklist, **not** acceptance of an unresolved-row recovery path.

Before deployment and FS-02 acceptance, verify the recorded keys and outcome
per unresolved operation, preserve unknown files in a recoverable quarantine,
and implement/test an audited manual resolution. Confirm no other non-interactive
business-file writer bypasses the gate, rehearse interruption/restart and failure of
the lease connection, and verify browser messages in the installed build.
FS-03 additionally requires competitive uploads, process crash, connection
loss and restart acceptance. Never interpret `accepting=true` with zero active
rows as a drained state: new writes can begin immediately.
