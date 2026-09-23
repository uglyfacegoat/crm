# Private object storage

Status: S3 application and backup-staging paths are implemented; the existing working
installation remains on local storage. Do **not** change its backend before the
migration/rollback acceptance below is complete. This is not closure of P0.6.

## Configuration and access

`DOCUMENT_STORAGE_BACKEND` accepts `local` or `s3`. Unset means the existing local
backend for backward compatibility, not an error fallback. In S3 mode these are required:

- `DOCUMENT_S3_ENDPOINT`: HTTPS origin without credentials, path or query.
- `DOCUMENT_S3_REGION` and `DOCUMENT_S3_BUCKET`: explicitly provisioned region/bucket.
- `DOCUMENT_S3_ACCESS_KEY_ID` and `DOCUMENT_S3_SECRET_ACCESS_KEY`: server-side credentials.
- `DOCUMENT_S3_FORCE_PATH_STYLE`: `true` only if the selected provider requires it.
- `DOCUMENT_S3_TIMEOUT_MS`: 1000–120000 ms, default 30000; covers response body consumption.

Compose passes the same configuration to web and backup worker. Secrets must not use
`NEXT_PUBLIC_`, appear in source control, images, command arguments or logs. Provision
separate least-privilege credentials for environments. The app needs GetObject,
PutObject and DeleteObject on its private bucket's generated object keys; the backup
worker can use a separate read-only identity in a deployment-specific override.
Do not grant anonymous access or bucket administration to the application identity.
Enable the provider's public-access block and encryption at rest; verify their actual
configuration before accepting a provider. The app does not create buckets, grant ACLs,
or change encryption/retention policies automatically.

Only explicit loopback tests may use HTTP by setting
`DOCUMENT_S3_ALLOW_LOCAL_HTTP=true`; it rejects non-loopback HTTP hosts. This switch
is not exposed by the production Compose definition. Do not bypass TLS checks.

## Invariants

- All user downloads still pass through authenticated CRM handlers and repository
  authorization. Storage URLs/credentials are not handed to the browser.
- Keys and historical versions retain their existing generated layout. S3 PUT uses
  `If-None-Match: *`, a content length and SHA-256 checksum. An existing object is
  an explicit `EEXIST` failure, never an overwrite. Conditional-write support must
  be verified against the chosen provider, not inferred from an S3-compatible label.
- Reads validate expected size/hash before allocation, cap the streamed bytes, verify
  the final hash and destroy incomplete streams. ETag is not used as a content hash.
- GET may attempt twice within the same deadline. PUT/DELETE use one attempt: a lost
  response is not proof of rollback. Unconfirmed uploaded objects may remain without
  a DB reference and must not be silently adopted or deleted on retry.
- S3 failures never fall back to local disk. A missing bucket/permission failure is
  not treated as a missing object. Public error messages omit endpoint/credentials.
- The backup worker locks the same four reference tables and stages verified S3
  bytes under the existing PostgreSQL snapshot. It then dumps that snapshot and
  archives the private local staging directory, retaining the format-2 restore path.
  A read/integrity failure aborts the snapshot, not an incomplete successful backup.

AWS references: [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
[stream lifecycle](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html),
[checksum support](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html).

## Verification

`npm run test:s3-storage` starts a unique loopback-only, RAM-backed Docker fixture with
random credentials and a new private bucket. It removes only that fixture at the end.
The pinned archived MinIO release is a compatibility test target, **not** the recommended
production service. Repeat conditional-write, anonymous-access and timeout tests against
the selected supported service before migration. Passing one provider is not a universal
compatibility guarantee.

For complete application acceptance, run the upload browser harness with
`UPLOAD_CHECK_STORAGE=s3`, an isolated `MIGRATION_TEST_ADMIN_URL`, a built
`UPLOAD_CHECK_RUNTIME` and `CHROME_PATH`. It provisions its own bucket/company, exercises
all upload families, downloads, ZIP and verified backup staging, then removes its test
resources. Never point that harness at the working company.

`npm run test:s3-backup` with `S3_BACKUP_TEST_IMAGE` and `BACKUP_TEST_ADMIN_URL` set
additionally runs the **packaged worker**, makes a coordinated archive, restores a
separate database, verifies all retained references, then removes one remote object
and requires backup failure even with valid local bytes available. Use a built image
and isolated PostgreSQL address reachable from Docker. The Docker hostname
`host.docker.internal` is mapped to the host gateway in the fixture; select the test
database port, never the working database.

## Migration and rollback gates — still open

1. Provision a supported private service, least-privilege credentials, TLS, public-access
   denial, at-rest encryption and an independent recovery destination. Validate them.
2. Accept the [writer-drained transfer candidate](STORAGE_TRANSFER.md): copy every retained
   reference, including history/deleted-message files, with exclusive writes and checksum
   verification. Do not delete or mutate the source. A DB table lock alone does not drain
   pending uploads.
3. Verify DB/file counts, every hash, authorized and anonymous requests, a full coordinated
   backup/restore, and application behavior while object storage is unavailable.
4. Switch web and backup together only after successful verification. Keep the old image
   and source files. Reverting the environment is safe only before new S3 writes: after
   writes resume, first drain writers and synchronize/verify those new references back
   to local storage (or restore a formally accepted recovery point).
5. Implement S3 inventory/version-aware reconciliation and safe quarantine. The existing
   local `storage:audit` CLI explicitly refuses S3 mode instead of falsely auditing an
   unrelated directory. No remote cleanup or lifecycle deletion policy is yet approved.
6. Complete malware/content scanning, aggregate quotas, load acceptance, retention,
   encrypted offsite backup, operational alerts and recovery drills from the main plan.

Keep these requirements unchecked until actual evidence is recorded. Provider-side
versioning does not replace application history, content verification or backups.
