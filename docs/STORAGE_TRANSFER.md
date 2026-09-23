# Document storage transfer — source candidate

This command prepares file bytes for a later local ↔ S3 backend switch. It
does **not** switch web or backup-worker configuration, remove a source file,
or authorize production cutover. The working CRM still uses local storage.

Migration 062 creates one durable transfer session and one row per distinct
retained key. The inventory reads all four reference tables without filtering
archived documents, inactive templates, older versions or deleted-message
attachments. The session stores reference counts, distinct file count, byte
total and a hash of the full reference snapshot. Each copied item is marked
complete only after the destination's size and SHA-256 are verified. A failed
or interrupted session stays `prepared` and blocks the drain command's
`resume`; the same ID/case/operator can retry. It rechecks existing destination
bytes and the original reference snapshot, and never replaces a conflict. A
new or changed reference on retry stops the transfer. Completed rows cannot be changed or
deleted by the application role.

Before either direction, stop every writer process, persist `pause`, inspect
and resolve every uncertain file-write operation, and retain a private storage
audit. Supply `DATABASE_URL`, the absolute local `DOCUMENT_STORAGE_ROOT`, and
the destination/source `DOCUMENT_S3_*` configuration in the operator
environment. Use a dedicated S3 identity limited to GetObject/PutObject for
the generated keys. In a temporary environment:

```sh
node scripts/storage-transfer.mjs local_to_s3 <transfer-uuid> <case-id> <operator-name>
node scripts/storage-transfer.mjs inspect <transfer-uuid>
```

The transfer refuses S3 keys with multiple versions or delete markers even if
the current bytes match. It uses conditional S3 writes and verifies the bytes
again on readback. A lost PUT response is accepted only when the destination
already has the exact expected bytes. The local source remains unchanged.
After the command completes, run the full storage audit and coordinated
backup/restore rehearsal before switching web and backup-worker together.

If new files have been written to S3 and local rollback is needed, keep the
writers paused and run a **new** session in the reverse direction before
changing the backend:

```sh
node scripts/storage-transfer.mjs s3_to_local <new-transfer-uuid> <case-id> <operator-name>
node scripts/storage-transfer.mjs inspect <new-transfer-uuid>
```

The reverse path verifies every current S3 source and copies only missing
local files. An existing local file with different bytes stops the transfer;
it is never overwritten. The command verifies the reference inventory and
S3 version inventory again before marking complete. In a disposable
PostgreSQL/MinIO test, five retained files from all four families copied
forward after an interruption, a changed reference was refused, and six copied back after a new S3-only
document version appeared. A conflicting local file blocked rollback until
the disposable fixture was corrected. A packaged image applied 62 migrations
on a disposable database, copied local → S3, then copied a newly referenced
S3-only file back to a persistent local volume. `inspect` and `resume` passed,
and both local files remained readable after the app container was removed.
An independent storage audit checked all five references after forward copy
and all six after reverse copy against both backends, with no findings.
Fresh standalone browser suites passed 18 uploads and nine warning states in
each backend, including the paused-upload message; S3 backup staging verified
the same four reference families. The coordinated rehearsal also uploaded a
new file through the S3 web, included it in a packaged backup, transferred it
back to local and verified its download and ZIP bytes from the local web.
These runs used disposable databases.
Working-volume, chosen-provider and coordinated cutover/rollback acceptance
remain open.

For a disposable coordinated rehearsal, build and copy the standalone static
assets, set `MIGRATION_TEST_ADMIN_URL` to a test PostgreSQL administrator,
`STORAGE_CUTOVER_TEST_DOCKER_ADMIN_URL` to that same administrator address as
reachable from a container, `STORAGE_CUTOVER_TEST_RUNTIME` to the built
`server.js`, `STORAGE_CUTOVER_TEST_IMAGE` to the matching production image,
and `CHROME_PATH` to the local Chrome binary.
Then run `npm run test:storage-cutover`. It creates and removes its own
database, MinIO fixture and private backup volume. It verifies authenticated
historical/current downloads and ZIP before and after the web backend switch,
uploads a new file through the S3 web, then runs the packaged S3 backup worker
and checks the archive from a separate container. After the reverse transfer,
the local web must serve that new file and its ZIP with identical bytes. This
does not switch the installed CRM or substitute for acceptance against the
selected provider.
