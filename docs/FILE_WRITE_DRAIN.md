# File write drain — source candidate

The implementation added on 2026-09-23 is **not installed in the working CRM**.
FS-02/03 remain open. Do not switch storage or clear unresolved operations on the
strength of the tests below alone.

`db/migrations/056_file_write_control.sql` creates a persistent accepting flag
and one row per started file operation. Each of the nine interactive upload
paths, plus the local example seed, acquires a PostgreSQL shared advisory lock, checks the flag, inserts its
operation row, and holds the lock through file I/O, business commit or rollback,
and owned-file cleanup. A paused upload receives a specific user-facing error
before writing bytes. Text-only chat and finance operations without receipts
continue. The gate uses a separate bounded pool so an operation cannot consume
all connections needed for its own business transaction.

The operator command `node scripts/file-write-drain.mjs pause` persists
`accepting=false` and waits for current advisory-lock holders. It reports
`drained=true` only after locks have left **and** the durable operation table
is empty. A process crash or DB connection loss may release an advisory lock
while work has no confirmed outcome; its operation row remains. `resume`
refuses while any such row exists. `status` reports the current flag and count.
The command must use the target environment's `DATABASE_URL`; its pause mode
returns exit code 2 when unresolved operations remain. No command automatically
deletes those rows.

On an isolated PostgreSQL 17 database, `npm run test:file-drain` verifies that
pause waits for two concurrent operations, rejects a new write and the local
example seed, persists across new
connections, and remains undrained after a process crash or termination of
the lease's database connection. The existing action tests cover a user-facing
pause response before storage I/O, and the receipt integration suite still
covers actual database commits and lost COMMIT acknowledgements. The new test
is included in CI configuration; remote CI execution has not been observed.

Before deployment and FS-02 acceptance, finish the operator procedure for
unresolved rows: stop all app writers, compare persisted references and actual
bytes, preserve unknown files in a recoverable quarantine, and only then
resolve each row with an audited manual action. Confirm no other non-interactive
business-file writer bypasses the gate, test the packaged runtime
against a disposable database, rehearse interruption/restart and failure of
the lease connection, and verify browser messages in the installed build.
FS-03 additionally requires competitive uploads, process crash, connection
loss and restart acceptance. Never interpret `accepting=true` with zero active
rows as a drained state: new writes can begin immediately.
