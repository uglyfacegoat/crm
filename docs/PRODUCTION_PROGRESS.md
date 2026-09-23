# Production: evidence and remaining work

For a plain-language explanation of what changed, why the checklist stays open,
and what is installed in the working CRM, see [PRODUCTION_STATUS_SIMPLE.md](PRODUCTION_STATUS_SIMPLE.md).

Authoritative scope: `PEREDVIDEOPOKAZOM/END_PRODUCTION_PLAN.md`, sections 4–15.
Started 2026-09-20. The user excludes purchasing a domain and server for now.
That exclusion does not waive application security, configuration, recovery, or local verification.
The overall goal remains active; this document is not a declaration of production readiness.

## Current evidence

- **2026-09-23, OBS-07 storage readiness candidate:** `/ready` and `/health`
  now check both PostgreSQL and the selected document storage. Local mode
  requires an accessible real directory; S3 mode makes one bounded,
  authenticated HeadBucket call without creating an object. An isolated
  packaged HTTPS test denied local-volume writes, observed 503 with database
  still available, restored permission and observed 200, then stopped its
  disposable database and observed live 200 / ready 503. S3 fixture checks
  access, bad credentials and offline endpoint. Local build, six startup
  tests, 12 S3 checks, lint and packaged TLS acceptance passed. Real provider
  acceptance and writeability/recovery checks remain open.
- **2026-09-23, OBS-07 packaged HTTPS acceptance:** the freshly built runtime
  image passed the isolated TLS ingress suite. After stopping only its disposable
  PostgreSQL container, `/live` remained 200 while `/ready` and `/health`
  returned 503 with `Cache-Control: no-store`; response bodies and web logs
  excluded the fixture credentials. Local browser and HTTPS checks passed using
  installed Chrome. S3/storage dependency checks and worker freshness alerts
  remain open.
- **2026-09-23, OBS-02 operator CLI startup redaction candidate:**
  `file-write-drain` and `backup-restore-check` now catch top-level failures
  and emit safe categories rather than Node exception stacks. The process
  check covers both commands with a secret-bearing database URL. 204 unit
  tests, isolated file-drain integration and lint pass. This is source-only
  until the candidate image is accepted.
- **2026-09-23, OBS-02 CLI/worker log redaction candidate:** eight recovery,
  quarantine, transfer and audit commands now emit only a fixed failure
  category or allowlisted system/SQL code; arbitrary exception messages and
  provider-defined codes are excluded. Backup and reminder workers apply the
  same rule to persisted failure codes. The helper is copied into the runtime
  image. Startup connection failures in migration and both workers are also
  caught without a Node stack trace; a process test checks that a database
  password is absent.
  204 unit tests, five isolated migration checks and lint pass; isolated
  storage-audit integration, typecheck and local production build passed
  before the startup-catch addition. All five jobs passed for the startup
  patch in [GitHub run 35913931910](https://github.com/uglyfacegoat/crm/actions/runs/35913931910).
  Other log sources still need audit.
- **2026-09-23, OBS-02 HTTP log redaction candidate:** 32 action/route files
  now record an allowlisted error code instead of serializing arbitrary
  exception messages, which may contain database details or user data. A unit
  check rejects a secret-bearing message and arbitrary code. 202 unit tests,
  affected action/download checks, lint, typecheck and local production build
  pass. Worker/CLI logging and all other event sources remain to be audited.
- **2026-09-23, OBS-07 health split candidate:** new live/ready endpoints
  separate process response from PostgreSQL readiness; `/health` remains the
  compatibility readiness address. A real standalone server with an unreachable
  database returned 200 for liveness and 503 for both readiness addresses,
  without returning or logging the test database password. Local build,
  six startup tests, typecheck and lint pass. All five jobs passed in
  [GitHub run 35912451543](https://github.com/uglyfacegoat/crm/actions/runs/35912451543).
  Storage/S3 dependency checks,
  worker freshness alerts and installed-runtime acceptance remain open.
- **2026-09-23, REL-02 remote CI passed:** [GitHub run 35909351720](https://github.com/uglyfacegoat/crm/actions/runs/35909351720)
  completed successfully at commit `20f104b`; all five jobs passed: quality,
  dependency security, HTTPS ingress, migration/runtime HTTP/browser flows,
  and packaged local/S3 backup and storage audit. This supersedes earlier
  historical notes below that remote CI had not been observed. Required branch
  checks, representative-volume acceptance and production cutover are separate
  open items.
- **2026-09-23, REL-03 branch protection:** the private repository's default
  branch is `master` and it is not protected. GitHub's protection and ruleset
  APIs respond 403 with an upgrade-or-public-repository requirement on the
  current plan. No required checks are enforced before merge.
- **2026-09-23, REL-05 HTTPS release image parity:** the production Compose
  override now requires an explicit candidate image for web and both workers.
  The resolved configuration keeps app and database ports private and sets
  secure-cookie/proxy mode; the CI HTTPS job checks these properties before
  exercising the isolated gateway. The first remote assertion found that a
  clean checkout lacks local `.env.docker-*` files; the CI step now creates
  empty temporary files solely for Compose parsing. The same check passes
  against a clean temporary checkout locally; a repeat remote run is pending.
- **2026-09-23, REL-01 local build:** nine empty, generated `.next` directories
  with anomalous link counts were removed. Two consecutive host `npm run build`
  commands completed in about five and three seconds without recreating them.
  No source or company data was removed. GitHub quality then found two download
  tests writing fixtures through the now lease-protected business API; both
  tests use direct writes into a disposable directory and pass locally (8 and
  20 TAP checks), as do lint and typecheck.
- **2026-09-23, first remote CI run:** all five jobs started; the dependency
  scan passed. The other failures exposed missing checked-in HTTPS Compose
  configuration, an uncreated empty storage directory in the HTTP job, and
  a Linux Docker host-network difference in the packaged S3 test. The
  storage-directory fix is in the workflow; the S3 runner now uses host
  networking on Linux and retains the verified Docker Desktop path on macOS.
  The macOS packaged S3 suite still passes all 21 checks. The missing HTTPS
  override and shared nginx template have since been restored. A standalone
  Compose fixture passed TLS 1.2/1.3, verified certificate, redirects, secure
  cookies, login, Host/Origin checks, body caps and spoof-resistant 429 limits
  on this Mac. The production override resolves with only the gateway ports
  exposed. A repeat remote CI result is still needed.
- **2026-09-23, packaged S3 audit on Linux:** the first repeated CI run
  exposed the same loopback-only Docker port issue in its packaged audit CLI.
  The audit fixture now uses host networking and the published fixture ports
  on Linux while retaining the Docker Desktop path. Its local packaged suite
  passes 27 TAP checks; Linux CI confirmation remains open.
- **2026-09-23, second complete GitHub CI run:** quality, dependency security,
  HTTPS ingress and database/runtime HTTP/browser jobs passed. The backup job
  passed packaged local and S3 backup/restore, then failed its packaged S3
  audit at the Linux Docker host boundary described above. That final audit
  fixture fix awaits a new remote run.
- **2026-09-23, REL-02 CI validation:** authenticated read-only GitHub CLI
  access through the existing Git credential found failed push runs with no
  jobs. `actionlint` identified the invalid job-level `runner.temp` context;
  the storage path now uses a fixed temporary directory and the workflow
  passes `actionlint`. Full remote job results remain to be checked.
- **2026-09-23, BK-04 retention guard:** age-based cleanup now excludes both
  the most recent accepted, restore-verified archive and the new verified
  archive awaiting its success record, in protected and host-export roots.
  A unit test proves expired older copies are removed while those two remain.
  The owner has not set daily/weekly/monthly retention, RPO or RTO.
- **2026-09-23, BK-03 host-export verification:** the backup worker now checks
  the exact exported member set, every copied SHA-256 and the source manifest
  hash before publishing the host copy. An isolated test corrupts a copied
  member, forges a matching copied manifest, and adds an extra member; none
  becomes a published backup. The new production image passed both packaged
  local and S3 backup/restore suites, including checks on the exported copy.
  Independent offsite delivery and acknowledgement remain open.
- **2026-09-23, SEC-04 test isolation candidate:** the transfer, cutover,
  local/packaged backup restore, packaged S3 backup, full-staging-volume and main PostgreSQL integration npm
  commands now provision their own PostgreSQL 17 container with random credentials and a temporary data
  filesystem. They pass only its URLs to the test process and remove it on
  completion. The transfer and cutover commands also passed with deliberately
  invalid inherited admin URLs, proving their temporary URLs take precedence.
  The packaged `test:backup-restore` path passed all 20 tests even with an
  invalid inherited admin URL. Migration, drain, recovery, quarantine, S3 export/quarantine, request-limit,
  chat-access, finance-receipt, local/S3 audit and S3 upload-browser commands
  passed without using the CRM PostgreSQL server. Direct script invocation,
  remaining flow commands and dev/staging/production secret separation remain open.
- **2026-09-23, FS-09 disposable cutover rehearsal:** after the forward
  five-file transfer and independent local/S3 audits, a built standalone web
  served both historical document versions, the current version and ZIP over
  authenticated HTTP in local mode, then again in S3 mode on the same
  disposable database. The packaged backup worker read S3, recorded verified
  counts for all four reference families and produced an archive on a private
  Docker volume. A separate container restored and checked that archive.
  A browser then uploaded a new document while S3 writes were enabled. The
  production web image, running as a separate disposable container, served
  both historical versions, the new file and its ZIP from S3. The packaged
  worker backup included that sixth reference. After writer pause and the
  verified S3 → local transfer, the local web served the new file and its ZIP
  byte-for-byte. This is a candidate rehearsal, not the installed web/worker
  cutover or chosen-provider acceptance.
- **2026-09-23, FS-11 failure checks (source candidate):** S3 reads now have
  explicit disposable-server tests for an unavailable endpoint and a response
  interrupted after one byte; neither returns a file. Backup snapshot staging
  removes a partial object file after a simulated `ENOSPC` write. The isolated
  PostgreSQL test proves no dump begins, snapshot sessions close and a clean
  retry copies all five references. `test:s3-storage` and the Docker-run
  `backup-restore.integration.mjs` pass. The built
  `crm-app:fs11-candidate-20260923` also passed the full packaged S3 backup/
  restore suite (21 tests) on a disposable database and MinIO bucket, including
  missing-object failure despite valid local bytes. A separate packaged run
  on a 1 MiB tmpfs reproduced actual `ENOSPC`, confirmed no partial staged
  object or leaked snapshot session, then copied all references after the
  volume was freed. Chosen-provider and application-level disaster recovery
  acceptance remain open.
- **2026-09-23, transfer follow-up acceptance:** the independent storage
  audit found no issues after forward copy (five references verified in both
  local and S3) or reverse copy (six in both). On a fresh standalone build,
  both local and S3 browser suites passed 18 real uploads, nine injected
  warning states, the paused-upload refusal and no browser errors. S3 backup
  staging verified all four reference families and historical hashes. These
  checks used disposable databases and storage, not the installed CRM.
- **2026-09-23, storage transfer source candidate:** migration 062 adds a
  per-key, append-only journal and blocks writer `resume` while a session is
  unfinished. The command copies the complete four-family reference snapshot
  local → S3 and S3 → local, verifies size/hash, rejects unexpected S3 history
  and never overwrites a conflicting destination. A disposable PostgreSQL/
  MinIO test covers five retained files including archived/old/inactive/deleted
  cases, interrupted forward transfer, changed-reference refusal, six-file reverse transfer after a new
  S3-only version, conflict refusal and restart before the complete marker.
  The packaged image applied 62 migrations on a disposable database and passed
  local → S3, a new S3-only file, S3 → local, journal inspection and resume;
  local bytes survived app-container removal. The separate storage-audit
  implementation verified five references in both backends after forward
  copy and six after reverse copy, with no findings. Working-volume, chosen-provider
  and coordinated cutover acceptance remain open.
- **2026-09-23, S3 archive restore drill candidate:** migration 061 adds an
  append-only report. A dedicated restore command verifies the completed
  quarantine archive, conditionally writes each historical object into a
  distinct destination bucket, reads back size/SHA-256, and accepts an
  identical retry and refuses a changed destination object. The disposable
  MinIO test restored both versions after source deletion and recorded the
  delete marker in its report. This is byte
  recovery to a second bucket on the same temporary provider. The packaged
  image applied 61 migrations and completed the same flow with readback and
  SHA-256 checks plus identical retry. A full database/application or
  independent-provider disaster recovery drill remains open.
- **2026-09-23, versioned S3 quarantine source candidate:** migration 060
  records `prepared` before deleting any version and protects the completed
  history. The operator command verifies every archived version, refuses a
  committed reference, deletes only listed version IDs, and retries a subset
  after interruption. Recovery review checks the archive before resolution.
  A disposable MinIO/PostgreSQL test covers corruption, deletion interrupted
  twice, wrong case, referenced-key refusal, denied delete credentials and an external removal without
  quarantine audit. The packaged image applied 60 migrations and completed
  export/quarantine/review/resolve/resume on a disposable MinIO bucket; two
  historical object versions remained readable from the private volume after
  the app container was removed. Chosen-provider acceptance and an independent
  restore drill remain open; the working CRM has not been upgraded.
- **2026-09-23, S3 version preservation candidate:** migration 059 and a
  read-only export command preserve each explicitly addressed object version
  plus delete-marker metadata in a private local manifest. The command
  checks size/SHA-256, requires pause and an enabled-versioning bucket, rechecks
  inventory, and records an append-only manifest hash, case and operator. A
  disposable MinIO/PostgreSQL test covers two versions, a delete marker,
  identical retry, wrong case, changed inventory and immutable audit. This
  does not remove any S3 version or unblock recovery resolution. A packaged
  image applied 59 migrations on a disposable database and exported two object
  versions plus a delete marker to a private Docker volume; the bytes survived
  container removal. Provider acceptance and S3 quarantine remain open.
- **2026-09-23, container-loss drill:** on a disposable database,
  one packaged container paused file writes and quarantined an unreferenced
  file on a private Docker volume. That container was removed. A new packaged
  container with the same database and quarantine volume applied migrations
  idempotently, then exported the verified bytes to a second private volume.
  The exported file was readable after the second container was removed.
  This proves the local quarantine copy is recoverable across app-container
  replacement; it does not prove restoration into active document storage.
- **2026-09-23, S3 recovery guard:** a referenced write-once key
  with multiple versions or a delete marker now blocks manual resolution even
  if its latest bytes match the database reference. A disposable versioned S3
  fixture proved the matching-current-bytes case is refused. Historical
  versions still need individual classification and S3 quarantine; no S3
  object was deleted by the recovery tool.
- **2026-09-23, quarantine recovery export:** a local-only command
  reads a completed quarantine manifest and matching case ID, checks the
  original copy, then creates a private checksum-verified export outside both
  storage and quarantine without replacing an existing file. Source tests
  reject wrong cases, nested destinations, corrupt copies and repeat writes.
  A disposable packaged image with 58 migrations exported onto a second
  private Docker volume; the bytes survived container removal. This is an
  extraction tool for operator review, not an automatic return to live storage.
  Full restore drill and S3 quarantine remain open.
- **2026-09-23 20:37 MSK, local quarantine candidate:** migration 058 records
  prepared/completed moves with source size, SHA-256, case and operator. The
  local command requires pause, verifies four reference families, copies into
  a private destination, syncs and verifies bytes before removing the source,
  and retries safely after interruptions. Recovery review rechecks the copy
  and only accepts the same case ID. Disposable PostgreSQL integration covers
  interruption before copy, after copy and after unlink, corruption, referenced
  file refusal, immutability and resolution. An isolated packaged image applied
  58 migrations and passed HTTP health, pause, quarantine, review, resolve,
  retained-byte verification and resume. The final image has no built-in
  quarantine directory. A repeat with a private Docker volume passed the
  same flow, and the copied bytes survived container removal. Restore from
  quarantine and S3 quarantine remain open. Working CRM remains on 55 migrations.
- **2026-09-23 20:17 MSK, source only:** the recovery review now handles S3
  via the read-only version inventory. Referenced current bytes must verify;
  an unreferenced key with any historical version or delete marker remains
  ineligible. The review hash includes backend/versioning/version metadata.
  A disposable S3 fixture covers a valid reference, an unreferenced object,
  enabled versioning with a delete marker, and CLI invocation from the source
  checkout. A newly built image then applied 57 migrations on a disposable
  database and rejected an unreferenced object from a disposable S3 bucket
  through its packaged CLI. Both temporary containers and the database were
  removed. Full S3 recovery and quarantine acceptance remain open.
- **2026-09-23 20:08 MSK, source candidate:** migration 057 and a local-only
  manual recovery command now review each unresolved key against all four
  reference families and actual bytes. Resolution requires an unchanged review
  hash, a private evidence file, case ID and operator, and writes an append-only
  database record in the same transaction that removes the pending row.
  Disposable PostgreSQL tests cover paused-only access, absent keys, an
  unreferenced present file, a valid reference, damaged bytes, changed review,
  repeated identical resolution and rejection of changed evidence. The
  local packaged runtime then applied 57 migrations on
  its own disposable database and passed HTTP health plus
  pause/review/resolve/retry/resume; it was removed afterward. Quarantine and
  installed acceptance are pending; the working CRM still has 55 migrations.
  A follow-up fixture verifies two keys in one operation: one valid reference
  cannot mask another unreferenced file. Five migration scenarios, 200 unit
  tests, typecheck, lint, production Docker build, file-drain and recovery
  tests pass. The existing storage-audit suite passes 13 TAP when its admin URL
  targets the empty `postgres` database as required; the first run mistakenly
  used the schema-bearing working app database for its negative-schema case.
- **2026-09-23 20:00 MSK:** fixed a drain gap: a handled unknown COMMIT outcome
  or failed owned-file cleanup now retains its keyed operation row after the
  lease ends. PostgreSQL lease test confirms `pause` stays undrained and
  `resume` refuses; 28 receipt/commit integration checks assert retained rows
  for all nine file-action paths. Action tests cover failed cleanup (47+44
  TAP), 200 unit tests, typecheck, lint and production build pass. After the
  source fix, both local and S3 standalone browser suites again passed 18
  submissions, nine warning states and the paused-upload check. This is still
  source acceptance; working containers and migration count are unchanged.
- **2026-09-23 19:52 MSK:** FS-02/03 inspection now pages through every
  unresolved row with an ID cursor; the PostgreSQL test covers 101 rows and
  a fresh writer process rejected while paused. Disposable-browser acceptance
  passed with both local and S3 backends: 18 real upload submissions, nine
  warning states and an additional paused document submission in each run.
  The paused request displayed its message and created neither a file nor a
  reference. The first local attempt exposed an incomplete test-only
  standalone layout (missing static assets); after matching Docker packaging,
  both full runs passed. Working containers remain unchanged; audited
  resolution of uncertain writes and installed acceptance are still open.
- **2026-09-23 19:42 MSK:** packaged FS-02/03 candidate started against a disposable
  database, applied 56 migrations, passed health and pause/status/resume smoke;
  the database was removed. Added a paused-only, read-only `inspect` command
  for unresolved operation IDs/timestamps/intended storage keys and tested its
  refusal while writes are accepted. Keys are recorded before bytes are written.
  The recovery checklist now requires stopping writers and checking each
  interrupted outcome; safe audited resolution and installation remain open.
  The working CRM was not changed. After adding key tracking, 200 unit tests,
  five migration scenarios, file-drain and upload action suites, typecheck,
  lint and a new production Docker build pass. The keyed image also passed
  HTTP health and status/pause/inspect/resume on its own disposable database;
  that database and container were removed.
- Work in progress, **2026-09-23 19:30 MSK**: FS-02/03 source candidate adds
  a persisted pause flag, durable in-flight rows and shared/exclusive leases
  across nine interactive upload paths. PostgreSQL tests cover normal drain,
  process crash and loss of the advisory-lock connection; an unresolved row
  prevents resume. Existing upload action and receipt integration tests pass.
  The candidate is not installed and migration 056 has not touched the working
  database. See `docs/FILE_WRITE_DRAIN.md`; assessment stays **6.7/10**.
- Latest checkpoint: **2026-09-23 19:12 MSK**. Removed the canceled legacy CRM
  import flow and its three empty tables; migration 055 is applied in the
  working database. The missing FS-01 writer inventory is restored in
  `docs/STORAGE_WRITERS.md`. SEC-09 now covers both workers: 200 unit tests,
  lint, typecheck and production build pass; packaged workers accept the
  working configuration and reject an empty database URL before connecting.
  Both updated workers are healthy; web/database stayed running. Assessment
  remains **6.7/10**, estimated END completion **63%** because major P0 gates
  remain open. GitHub CI for this branch has not been observed.
- Earlier checkpoint: **2026-09-20 21:16 MSK**. S3 read-only inventory now passes
  all 24 leaf local/S3 integration scenarios (26 TAP including parents). The encoded-key
  defect is fixed and covered for spaces, literal plus and percent sequences. Fourteen
  additional protocol/error/deadline tests pass; scoped lint and diff whitespace checks
  pass. New runtime packaging and full-project checks remain pending. No working files
  were migrated or removed. Assessment remains **6.7/10**; END-plan estimated completion
  is **63%** (weighted matrix 63.36%). The main plan's “Выполнено и проверено” and section
  17 now contain these results and synchronized estimates; historical audit scores remain
  explicitly historical, not alternative current assessments.
- Current assessment: **6.7/10**, up from the historical 6.3 baseline. This is an
  evidence-based engineering estimate, not a completion percentage or certification.
- Current: 186 unit tests pass; eight auth-service scenarios passed at the earlier auth gate; full lint and typecheck pass;
  clean production Docker build passes. Local build-artifact cleanup is separately blocked below.
- Dependency scan: `npm audit --audit-level=high` reports zero vulnerabilities on 2026-09-20.
- Migration runner now serializes the full bootstrap/history/application sequence on a pinned connection.
  It rejects changed, removed and reordered applied migrations before executing pending SQL.
- `npm run test:migrations` passes against a separate PostgreSQL 17 instance:
  clean installation of 54 migrations, repeat deployment, upgrade from committed schema 049
  preserving an existing customer, three concurrent deployments, transactional rollback/retry,
  checksum/history rejection. This is not yet a restore drill or an upgrade from a real production backup.
- `.github/workflows/crm-ci.yml` defines typecheck, lint, unit tests, build, dependency audit,
  migration tests and authenticated HTTP smoke checks. GitHub execution and mandatory branch
  protection have not been verified; adding the file alone does not make checks mandatory.
- `scripts/production-smoke-check.mjs` checks a freshly created test company: database health,
  protected routes, login, cookie attributes, origin rejection, application page rendering,
  logout and invalidation of a copied session cookie. It also checks that empty production
  analytics/sites cannot be replaced with demo data, including `?data=example`.

## Shared backup recovery point — 2026-09-20

- Added format-2 archives with exported PostgreSQL snapshot and a private verified
  copy of referenced files. SHARE locks cover all four reference tables before any
  snapshot read. A read-only keeper retains the snapshot after staging commits, so
  file-reference writes resume before the database dump. Tar no longer reads live storage.
- A real concurrent-writer test observes the backup's lock wait, commits a preceding
  write, then replaces/deletes the old avatar while the dump runs. Restoring the dump
  and staged files confirms the same old reference/bytes, inclusion of the preceding
  write, exclusion of later writes, and omission of orphan/new files. This is a
  transactional fixture test, not a representative-volume performance acceptance.
- Added staging/operation/lock-failure cleanup tests and worker metadata assertions.
  Eighteen integration scenarios (19 TAP tests including parent) pass against the
  actual packaged scripts in `crm-app:backup-snapshot-check` (`ec3c4c0cdc9f`). The first
  run caught a wrong test-only column name; corrected to the real schema and reran.
- Backup subprocesses now have deadlines and SIGTERM→SIGKILL escalation. Three new
  unit tests cover ignored termination, missing executables, invalid deadlines and
  apparent zero exit after termination. Full lint/typecheck, 184 unit tests and a
  clean production Docker build pass. `git diff --check` passes.
- Installed only the backup worker (`ec3c4c0cdc9f`), healthy; prior worker image is
  retained as `crm-app:before-backup-snapshot` (`47c24ef76148`). Web/database/reminder
  container IDs are unchanged. Deployed script hashes match source. No new scheduled
  backup of the working company has been observed with this version yet; successful
  creation/restore evidence above is from isolated databases. Test databases were removed.
- IMPORTANT: source inspection found the initial document-upload action's generic
  error handler can remove an already committed file if post-commit revalidation
  throws. The version-upload path already has a committed guard. Audit/fix the initial
  upload and finance receipt cleanup, with post-commit fault-injection tests, before
  considering the storage lifecycle gate complete. This is a code-path risk, not a
  claim that a working-company file was lost. The backup rejects missing/corrupt files.
- Assessment reviewed and held at **6.7/10**. P0.3 remains open: encryption/offsite,
  retention tiers, recovery procedure/RPO/RTO, volume/lock-latency/disk budgets and
  independent scheduled drills still lack full acceptance. See `docs/BACKUP_RECOVERY.md`.

## Upload commit boundary — 2026-09-20 (source acceptance, not deployed)

- Initial document upload, document-version upload, payment and master payout now
  distinguish a confirmed commit from a subsequent cache-revalidation error.
  Confirmed records/files are retained. Actions report saved state with explicit
  `refreshRequired`; the three affected forms keep that warning visible instead of
  auto-closing, and their existing saved-state submit buttons remain disabled.
- Initial upload cleanup now checks that this request actually wrote the file.
  Known domain rejections still clean owned uncommitted files; existing files from
  another request are not removed. Unknown transaction failures retain bytes because
  a lost COMMIT acknowledgement does not establish rollback. The response explicitly
  says the outcome could not be confirmed and asks the user to inspect history.
- `npm run test:upload-commit` passes 24 scenarios (25 TAP tests including parent):
  all four actions, normal success, first/second revalidation failure, known rejection,
  existing-file ownership and unknown transaction outcome. Uses real temporary files
  and the real action/schema/file-validation code, with mocked repository and cache
  boundaries. This is not a real PostgreSQL commit/network-failure rehearsal.
- Added this check to CI; remote CI execution remains unverified. Full lint/typecheck
  and the existing 184-unit suite pass. Next.js/React review kept primitive effect
  dependencies and existing disabled-submit behavior; no runtime dependency added.
  Final production image `crm-app:upload-commit-check` (`03ff74ef2e71`) builds cleanly;
  no schema migration was introduced. `git diff --check` passes.
- Pending before deployment: isolated PostgreSQL/browser acceptance of uploads and
  receipts, visible warning/no-auto-close behavior, and final runtime-image smoke.
  Working web container remains unchanged; do not mistake the source fix for an
  installed fix. Assessment remains **6.7/10**.
- The EEXIST follow-up identified here is addressed in source by the receipt-retry
  gate below. Retained files after unknown outcomes still need safe reference
  reconciliation; do not delete them solely because one request failed.

## Receipt retry ownership — 2026-09-20 (source acceptance, not deployed)

Historical source gate; installation and browser acceptance are recorded below.

- Removed reuse of existing receipt files. Comparing bytes alone would not prevent
  one pending request from deleting a file another request had just committed.
  Confirmed retries now resolve the tenant-scoped idempotency record before file
  I/O, after checking `finance.write`. Existing unconfirmed file keys produce an
  explicit receipt error rather than reusing or deleting another request's bytes.
- The transaction retains its authoritative idempotency check. It now reports
  whether it created the ledger entry, so a concurrent request with a different
  receipt ID removes only its own unused file when the other request wins.
  Wrong-operation/incomplete request keys and permission denials have explicit
  user-safe errors. No migration or runtime dependency was introduced.
- `test:upload-commit` now passes 38 action scenarios (39 TAP tests with parent).
  Added confirmed retries without file reads, permission/request conflicts before
  I/O, identical/different existing bytes, competing rollback and unused-file cleanup.
- `test:finance-receipts` passes 13 scenarios (14 TAP tests with parent) against an
  isolated PostgreSQL 17 database and real storage. Exercises actual actions,
  repositories, transactions, metadata hashes, tenant isolation, permissions,
  post-commit cache failure and concurrent commit/rollback behind a real ledger
  row lock, including different receipt IDs for one request key. Only session,
  cache and database connection injection are mocked. This is not a network-loss
  COMMIT rehearsal or browser-warning acceptance. Disposable databases/files are
  removed by the harness. CI includes the command; remote execution is unverified.
- Full typecheck/lint and 184 unit tests pass; `git diff --check` is clean. The final
  application source builds as `crm-app:receipt-retry-check` (`76ceb8dc1d04`);
  this image has not been installed. Working web/backup/reminder/database services
  remain healthy and unchanged. No disposable receipt-test database remains.
- The earlier task-scroll evidence was rechecked on the running web at 1600/390 px;
  wheel/keyboard scroll only the individual groups, not the queue, headers or other
  groups. The completed list was additionally verified at 1600 px. No UI patch was
  necessary for that clarification.
- Assessment remains **6.7/10**. Receipt/source tests do not close the entire storage
  lifecycle gate. Browser acceptance of all upload warnings, real document/version
  persistence, final runtime smoke and installation remain pending, alongside safe
  reconciliation of retained files after uncertain outcomes.

## Upload browser acceptance and installation — 2026-09-20

- Added `scripts/uploads-browser-check.mjs` / `npm run test:uploads-browser`. It
  creates a disposable database and storage root, starts the supplied standalone
  build with generated test credentials, and tears down its resources on exit.
  The npm command now provisions its own PostgreSQL container; it requires
  `UPLOAD_CHECK_RUNTIME` (server.js), with `CHROME_PATH` and `UPLOAD_CHECK_ARTIFACTS`
  available for browser selection and artifacts. It uses local port 3100. CI runs it after
  the existing HTTP stand exits; remote CI execution remains unverified.
- Passed against the extracted production image `76ceb8dc1d04`: login/home/browser
  startup and the complete existing production HTTP smoke, then eight real form
  submissions (document, new version, payment, payout; normal and warning cases).
  Normal cases run at 1440px and warning cases at 390px. Verified PostgreSQL ledger
  amount/receipt linkage, file size/SHA-256, preserved document history and actual
  authenticated downloads of all uploaded versions. No browser exceptions or
  console errors occurred. Screenshots are in ignored `artifacts/uploads/`.
- Warning acceptance replaces exactly one confirmed successful Server Action result
  per form with the tested `refreshRequired` state. It proves that all four forms
  stay open beyond their auto-close timers, show the warning, disable resubmission,
  and allow manual dismissal. It does **not** simulate a backend cache failure or
  lost COMMIT acknowledgement; action/real-PostgreSQL fault tests cover the former,
  and a real network-loss rehearsal remains open. Early harness runs caught stale
  selectors (duplicate add buttons, ledger summary and tab roles); corrected against
  current markup before the full passing run, with no application workaround.
- Before installation, compared all 54 applied working-database migration checksums
  to source and the verified image: identical, with no pending schema change.
  Installed only `crm` as `76ceb8dc1d04` (also tagged `crm-app:local`). Rollback image
  retained as `crm-app:before-upload-ownership-20260920` (`7eab2f452ab9`). Database,
  backup and reminder container IDs are unchanged and healthy; web is healthy.
- Read-only acceptance after installation: authenticated home/documents/finance/tasks
  render without browser exceptions; task scroll checks pass at 1600/390px; all 11
  referenced files (4 document versions + 7 chat attachments, 4,462,390 bytes) pass
  size/checksum validation. No working-company business records were changed by tests.
  Disposable browser databases/storage were removed. Test script lint and diff
  whitespace checks pass. Application source was unchanged from the preceding
  successful typecheck/lint/184-unit/build gate.
- Updated assessment: **6.7/10**, held after this bounded installed correction.
  The upload guard/receipt retry/browser gate is closed; safe reconciliation after
  uncertain outcomes, backup/offsite/retention, broader business acceptance and all
  other unproven plan requirements remain open. This is not whole-product completion.

## Lost COMMIT acknowledgement — 2026-09-20

- Extended `test:finance-receipts` with real TCP disconnection for all four upload
  actions: initial document, document version, payment and master payout. A local
  plaintext test proxy forwards actual PostgreSQL traffic until the server returns
  `CommandComplete(COMMIT)`, then closes both sockets without forwarding that
  acknowledgement. Repository results/errors are not mocked. This is not a server
  crash, TLS/network-infrastructure rehearsal or whole-system availability test.
- Each action reports the explicitly unknown outcome rather than claiming rollback.
  A separate direct connection proves the committed record exists; real stored bytes
  pass size/SHA-256 verification. Retry through the reconnecting proxy succeeds with
  no duplicate ledger entry, money, document/version or creation audit event. Document
  version tests also verify the old version survives and the current pointer advances
  exactly once. Finance retry uses an invalid replacement file to prove it cannot
  replace the committed receipt. No working-company records or containers changed.
- The expanded suite passes twice: 17 scenarios (18 TAP tests including parent) on
  isolated PostgreSQL 17. Full typecheck, lint and 184 unit tests also pass; whitespace
  checks are clean. The harness removes its database, temporary storage, sockets and
  ephemeral listener. Existing CI already runs this command; remote CI is unverified.
  Only test infrastructure and progress documentation changed, not runtime source.
- Assessment reviewed and held at **6.7/10**. This closes the previously pending
  lost-acknowledgement rehearsal, not safe reconciliation of retained unreferenced
  files. Do not delete such files just because a failed action has no visible record:
  another in-flight transaction could still commit a reference. Storage lifecycle,
  backup/offsite/retention and the remaining production-plan acceptance stay open.

## Data-display corrections verified

- Removed automatic demo substitution in analytics, sites and site detail pages.
- Removed invented service distribution and traffic sparklines for missing data.
- Removed the silent three-site/three-source display limit and corrected source labels:
  those percentages represent incoming leads, not visitors.
- Missing traffic measurements remain null; a confirmed measurement of zero is not
  converted to missing data. Empty histories no longer create zero-valued charts.
- Isolated PostgreSQL + standalone production checks pass: HTTP authentication and
  fresh-company screens; four sites created through UI, persistence, missing-data
  states, search/filter, site details and responsive analytics at 390/834/1440 px.
- Existing sites flow also passes on the isolated database: integration secret-reference
  protection, persisted hosting/manual measurements, list widths 390–2048 and details
  at 320/3840 px. CI now includes this flow; remote CI execution remains unverified.

## Runtime configuration

- Added shared configuration schemas, a pre-migration Docker guard and a Next.js
  startup hook. Invalid mandatory settings terminate with code 1 without printing
  credential values. Explicit preview and local HTTP configurations remain supported.
- Seven configuration unit tests and five real standalone-process startup tests pass. The process
  tests caught Next.js keeping a failed hook alive; the hook now explicitly exits.
- Built Docker image also rejected an incomplete configuration with networking
  disabled, before migration execution. Existing local Docker settings passed
  preflight; the web container was rebuilt and restarted with the guard.
- See `docs/RUNTIME_CONFIGURATION.md` for scope, commands and remaining P0.2 work.

## Perimeter and HTTPS rehearsal

- Authenticated production requires explicit origins; Host and unsafe-method Origin
  validation also cover Server Actions. The bearer-authenticated website webhook
  remains an explicit exception, not an unauthenticated mutation endpoint.
- Client-supplied forwarding headers are ignored without explicit proxy trust.
  The HTTPS gateway overwrites them; the application accepts only validated X-Real-IP.
- Nonce CSP blocks a script injected into parsed HTML in Chrome. Production smoke,
  API/action rejection checks and both sites browser flows pass with CSP enabled.
  The initial DevTools-injected test did not observe CSP enforcement; it was replaced
  with parser-inserted HTML injection, not a weakened policy.
- The isolated `test:tls` rehearsal passed using the production image and nginx:
  no published app/database ports, verified localhost certificate, TLS 1.2/1.3,
  HTTP-to-HTTPS redirect, secure cookie flags, login action, Host/Origin rejection,
  32 KiB login / 16 MiB general body caps, and spoof-resistant 429 gateway responses.
- Login return destinations now reject backslashes/control characters in both page
  rendering and the action. Two unit tests and an actual forged-form browser login
  confirm that the user remains inside the application.
- Added CI job for that disposable TLS rehearsal. Remote CI execution is unverified.
- Base Compose binds to loopback by default; the HTTPS profile is opt-in. Certificate
  renewal, expiry monitoring, application-level quotas and complete upload/CSRF
  coverage remain open. See `docs/HTTPS_DEPLOYMENT.md`.
- Temporary TLS test containers, their database/file volumes and generated keys
  were removed by the test; working-company data was not used.
- Deployed the verified image to the local web container. It is healthy and now
  bound to `127.0.0.1:3000`; perimeter tests and independent task scrolling at
  1600/390 px pass against that deployed container. The previous image is retained
  as `crm-app:before-perimeter-005878f6`; workers and persistent volumes were unchanged.
- The built image also exits before migrations when trusted-proxy mode is combined
  with HTTP origins or insecure cookies (network disabled during the negative check).
## Authentication and bounded JSON — 2026-09-20

- Fixed the observed authentication defect: denied identity/client buckets now reject
  before credential lookup and scrypt. Both buckets are still consumed, and allowed
  unknown identities still run dummy password verification. No new login business rules.
- Eight scenarios test the actual auth service with mocked boundaries: identity/client
  denial, invalid input, unknown identity, successful hashed-token session, wrong password,
  locked/inactive accounts and throttle-storage failure. The test uses Node's test-only
  experimental module mocks; no production dependency or service injection was added.
- Actual HTTP + isolated PostgreSQL acceptance: eleven concurrent requests to a unique
  unknown identity produce exactly ten 401 responses and one 429, without cookies;
  a subsequent attempt remains 429. This does not substitute for the pending load test.
- The JSON reader stops reading once its byte budget is exceeded. Login/webhook use
  32 KiB, document export 16 KiB. Tests cover oversized declared and undeclared/chunked
  bodies, exact boundaries, invalid JSON/UTF-8 and authenticated endpoint boundaries.
  Unit tests additionally cover understated Content-Length, split UTF-8, cancellation
  and propagation of source-stream failures instead of silently returning an empty body.
- Production smoke, perimeter, body-limit checks, both sites browser flows and the
  isolated HTTPS rehearsal pass against image `crm-app:auth-check` (`530dc1fcadf3`).
  Full lint/typecheck, 167 unit tests and eight auth-service scenarios pass.
- Deployed that image to the local web container; health, perimeter/CSP and task
  scrolling checks at 1600/390 px pass after deployment. The previous image remains
  available as `crm-app:before-auth-af7b659580ca`. Database, storage and workers were
  not recreated. The browser check uses installed Chrome via explicit `CHROME_PATH`;
  the first post-deploy attempt lacked a downloaded Playwright browser, then passed
  with the correct executable (no application workaround).
- CI includes the service and real HTTP checks; remote CI execution remains unverified.
- Disposable test databases and the TLS project's test containers/volumes were removed
  by their harnesses. No working-company records were used for destructive test scenarios.
- Assessment reviewed and held at **6.6/10**: this closes a bounded P0.1 substep;
  quotas, storage, recovery, observability and business acceptance are still required.
- IMPORTANT local-development issue: the host's existing `.next/standalone/node_modules 2`
  tree contains abnormally large generated directories. `next build` remained in Next's
  pre-build recursive directory cleanup, confirmed with process sampling/open files.
  The process and stalled quarantine move were stopped; no source or company data was
  deleted. The old generated tree is not repaired. A clean Docker context excludes it
  and builds successfully; do not report that as a successful local `npm run build`.

## Search budgets and compatible rollback — 2026-09-20

- Added migration 054 and shared PostgreSQL member/organization request budgets;
  global search checks them after authentication/permission/input validation and
  before its business queries. Initial fixed-window limits are 120/1200 per minute.
  They are protective defaults, not a measured capacity or paid-plan requirement.
- Five actual-repository integration scenarios pass against PostgreSQL 17, including
  concurrent calls through two independent connection pools, organization sharing,
  tenant isolation, expiry, foreign keys/cascade and fail-closed database errors.
- HTTP checks pass for two sessions of the same member, changed queries and forged IPs,
  company denial, 429/Retry-After/no-store, permission rejection before consumption
  and recovery. Browser checks at 1440/390 px confirm visible errors, preserved query
  and successful manual retry; the mobile screenshot was visually inspected.
- Full lint/typecheck, 167 unit tests, eight auth scenarios and five migration tests
  pass. Docker image `crm-app:search-limits-check` (`ee1716764a2a`) builds cleanly.
  Fresh-company smoke, perimeter/CSP, JSON limits and both sites flows pass on it.
- Rehearsed the previous image `crm-app:before-search-530dc1fc` on the disposable
  schema-054 database with the current migrations mounted read-only. Normal entrypoint
  validation passed; migration history remained identical; login/tasks/clients/search
  worked. Plain old-image startup would correctly reject its missing migration 054.
  This narrow compatibility evidence does not prove all business rollback flows.
- Deployed the new image to local CRM; health, login and an ordinary authenticated
  search pass. The working company was not subjected to rate-limit exhaustion.
  Workers/storage/database containers were not recreated; no business data was deleted.
- Added repository and HTTP/browser checks to CI; remote execution remains unverified.
  Details, counter semantics, known fixed-window behavior and rollback constraints:
  `docs/REQUEST_LIMITS.md`. Chat/file/integration limits and realistic load checks remain open.
- Assessment increased from 6.6 to **6.7/10** for the verified application-level
  protection and compatible rollback evidence, not for the number of added tests.

## Chat upload authorization and draft preservation — 2026-09-20

- IMPORTANT defect fixed: message attachments and channel avatars could be read and
  written before resource-level authorization. Actions now check tenant, membership,
  active channel and permissions first; avatar preflight also checks editable channel
  type and version. The final database mutation still checks resource access.
- Added independent shared PostgreSQL budgets for message sends (60/member,
  600/company per minute) and attachment/avatar uploads (10/100). Confirmed message
  retries do not re-upload or consume another budget. Oversized file metadata is
  rejected before allocating the action's attachment buffer. Multipart parsing by
  Next.js still precedes the action; this is not a streaming upload or byte quota.
- Fixed two draft-loss causes: the composer no longer remounts when the last message
  changes, and resolved action errors no longer reset uncontrolled text/file inputs.
  Pending fields are disabled; confirmed success clears the draft and rotates its
  idempotency key. Drafts are not persisted across reloads/channel changes.
- Seven actual-action scenarios with mocked boundaries pass, plus six actual-chat-
  repository PostgreSQL scenarios for access, permissions, archived/removed membership,
  idempotency and avatar restrictions. Request-limit integration now has seven scenarios,
  including independent chat operation counters and concurrent organization denial.
- Real standalone browser + PostgreSQL checks pass at 1440/390 px: member/company
  denial, unchanged file storage, retained text/file/key, successful retry, incoming
  message refresh and forged channel. Mobile error screenshot was visually inspected.
  Voice recording/pause/resume/preview/delete checks pass; they do not test voice send.
  Removed a redundant navigation from that test which aborted an in-flight server
  response; the repeated chat/voice run completed without the stream-close warning.
- Full lint/typecheck, 167 unit tests, eight auth-service scenarios and clean Docker
  build pass. Fresh-company smoke, perimeter/CSP, bounded JSON, search recovery, both
  sites flows and isolated TLS acceptance pass against `crm-app:chat-limits-check`
  (`7cc7c75d81b3`). The disposable test databases and TLS resources were removed by
  their harnesses; no working-company data was used for rate exhaustion or file tests.
- Added action, repository and browser checks to CI; remote execution remains unverified.
  Details and uncovered operations remain explicit in `docs/REQUEST_LIMITS.md`.
- Installed the verified image in the local web container; container health is good.
  Previous image retained as `crm-app:before-chat-ee171676`. Database, storage and
  worker containers were not recreated. No new database migration was required.
- Post-deployment checks pass: authenticated chat rendering, enabled composer,
  refresh responses and no browser exceptions; independent task scrolling at
  1600/390 px. No messages/files were sent in the working company. The initial
  `networkidle` check timed out: a subsequent request trace isolated four pending
  audio metadata downloads while the chat page/action/refresh returned 200. The
  redundant diagnostic was stopped; its test browser also exited.
- IMPORTANT next file-flow work: audio metadata requests can remain pending; the
  current attachment endpoint reads/verifies the entire file and ignores Range.
  Investigate bounded, authorized ranged downloads and their quotas rather than
  treating a rendered page as full media acceptance. No media regression claim is
  made from the narrow voice-draft test.
- Assessment reviewed and held at **6.7/10**. This closes bounded chat sending/upload
  and draft-retention defects, not P0.1 or the full chat/authorization acceptance matrix.

## Attachment download candidate and recorded-voice regression — initial findings

- Candidate image `crm-app:chat-download-check` (`076334e032b8`) builds successfully.
  Working web remains on `crm-app:local` (`7cc7c75d81b3`); no candidate deployment yet.
- Added bounded, verified attachment reads, authorized Range/HEAD/conditional responses
  and separate 300/3000 per-minute member/company download budgets. Download auditing
  now occurs only for a GET which passes resource access, quota, integrity and range checks.
- Seven route/storage scenarios, eight actual PostgreSQL limiter scenarios, 170 unit
  tests, full lint and typecheck pass. New disposable browser/HTTP coverage verified actual
  WAV upload, metadata, play/pause/seek at 1440/390 px; exact ranges/HEAD/conditions;
  anonymous/permission/membership/deleted-message/cross-company denial; member/company
  quotas; corruption outside the requested slice; successful recovery after restoration.
- Fresh-company smoke, perimeter/CSP, bounded JSON, search, chat send/upload/draft and
  voice-draft checks, both sites flows and isolated TLS acceptance pass on the candidate.
  Test database/storage and TLS resources were removed by their harnesses; no working
  company records/files were changed. The TLS fixture volumes were disposable only.
- IMPORTANT: extending acceptance to a voice message actually recorded and sent through
  CRM found a real defect: Chrome reports `audio.duration === Infinity` for the persisted
  WebM. Existing draft-only tests did not detect it. The full download/audio flow now fails
  explicitly at this assertion, and CI includes that regression rather than omitting it.
  An earlier test timeout was the test expecting `0:03` instead of the UI's `00:03`; after
  correcting that selector condition, the duration failure reproduced twice.
- Next action: fix recorded WebM finalization/duration and the player's non-finite duration
  handling, test preview plus persisted playback/seek (including pause/resume), and assess
  older recordings without rewriting historical files implicitly. Repeat the full gate and
  deploy only after acceptance passes. No claim that Range alone fixes recorded voices.
- Technical context: [MDN duration](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration)
  describes Infinity for unknown duration; [fix-webm-duration](https://github.com/yusitnikov/fix-webm-duration)
  documents missing duration metadata from MediaRecorder WebM. A normalization library
  was researched, not installed; implementation/compatibility review is still required.
- Assessment reviewed and held at **6.7/10**: download protections progressed, but the
  newly reproduced end-to-end audio defect prevents calling this media acceptance complete.

## Recorded voice fix and media release — 2026-09-20

- The preceding candidate's failing regression now passes. New browser-recorded WebM
  receives duration metadata before preview/upload, using paused-time-excluding elapsed
  recording time. MP4 and historical files are not rewritten. Non-finite player duration
  is handled explicitly rather than displayed as zero or passed to `currentTime`.
- Added lazy, exact-version MIT parser/fixer dependencies; inspected their implementation
  and avoided the convenience wrapper's silent failure behavior. Three new unit tests
  cover metadata preservation, invalid duration/size/type/clock and untouched MP4 input.
  npm's unrelated removal of platform `libc` lock metadata was reverted; the lock diff
  contains only the two added packages and root dependency entries.
- Preparation failure preserves raw voice data for retry. Asynchronous results cannot
  restore a discarded/unmounted draft. Fixed ready-draft deletion leaving its File in
  the upload input; explicit tests verify both the upload field and cancelled preparation.
- On the final production build, the real browser/DB audio flow now passes: WAV at
  1440/390 px; microphone recording, pause/resume, injected read failure and retry,
  preview, send, reload, seek/play/pause; old raw WebM playback with original checksum
  and bytes retained. Old unknown-duration recordings can seek after their first full
  playback, not necessarily before it. New recordings can seek immediately after reload.
- Full lint/typecheck, 173 unit tests, seven chat-action scenarios, seven download-route/
  storage scenarios, six PostgreSQL chat-access and eight shared-budget scenarios pass.
  Final image also passes fresh-company smoke, perimeter/CSP, JSON/search/chat limits,
  voice-draft tests, both sites flows and isolated TLS acceptance. Browser mobile capture
  was inspected. Disposable fixtures were removed by their harnesses.
- Installed `crm-app:voice-duration-check` / `crm-app:local`, image
  `7eab2f452ab933aae438c2264db21e13fb122b3cd5bc7960ca237033b32fdd50`.
  Web health is good. Retained rollback image `crm-app:before-voice-7cc7c75d`;
  database/storage/worker containers were not recreated and no schema change was needed.
- Post-deployment read-only check: all five existing working-chat audio elements reached
  metadata-ready state, a 32-byte request returned 206/private-no-store, composer and
  refresh worked, and Chrome reported no page errors. Working-chat desktop screenshot
  was visually inspected. Independent task scrolling again passes at 1600/390 px.
  No messages/files were created, edited or deleted in the working company by these checks.
- Remaining media scope: real Safari/Firefox/device microphone acceptance, early seek
  for older metadata-less files, accessible keyboard seeking, long-recording memory
  limits, malware scanning and other-domain storage flows. No broader chat or P0 storage
  completion claim. Remote CI execution/required checks remain unverified.
- Assessment reviewed and held at **6.7/10**. The recorded-voice regression and bounded
  authorized download release are completed substeps, not completion of P0.1/P0.6 or
  the business launch gates.

## Backup file integrity and independent restore rehearsal — 2026-09-20

- Previous task-scroll response supplied fresh live verification but no implementation
  change. This production step changes the verifier/worker and tests a real archived
  copy; it does not declare the whole recovery requirement complete.
- Found that a valid archive manifest plus readable tables could pass despite missing
  or altered files referenced by the database. The verifier now checks all retained
  document versions, template versions, chat attachments and channel avatars, using
  bounded database cursors and streamed file hashing. Historical/soft-deleted references
  remain in scope. Size, regular-file status, organization/key consistency and SHA-256
  must match; missing and changed files fail the run.
- Manifest verification requires exactly the three unique expected filenames. Linked
  archive members, unsafe/duplicate tar paths, symlinks/hard links and special entries
  are rejected before extraction. The integration test caught BusyBox displaying hard
  links with a regular-file mode plus ` -> `; the validation now covers that format too.
  This is corruption/path protection, not cryptographic authenticity of an archive.
  Final review also fixed process capture accepting truncated output in an exit race;
  oversized tar listings now always fail. Two process tests cover complete/error output
  and output beyond the capture cap.
- Worker results include per-table file counts, total verified bytes and measured
  restore duration. Retention now finishes before a run is marked successful, avoiding
  conflicting successful-run/failed-job states. Failed `--run-once` returns exit code 1.
  The fixture checks a real retention permission failure as well as missing files.
- Added `--verify-only` for independent restore checks: no write to the source backup
  history, and no requirement for CRM tables in the destination admin database.
  [BACKUP_RECOVERY.md](BACKUP_RECOVERY.md) documents the command, trust boundary and gaps.
- Verification: 181 unit tests, full lint/typecheck and clean production Docker build
  passed. Packaged runtime scripts passed 14 integration scenarios (15 TAP tests with
  the parent), using actual PostgreSQL 17 dump/restore, all 54 application migrations,
  historical files, failures, CLI modes and cleanup. The CI job is added; GitHub execution
  remains unverified. No schema change or new dependency was introduced.
- Independent actual-copy drill: read-only archive `20260920T125428Z-8375b97e` restored
  into the separate `crm-production-gates-postgres` instance, not the working server.
  Result: 53 migrations, 4 document versions + 7 chat attachments, 4,462,390 verified
  bytes, all hashes matched. First run including concurrent build load: 2,809 ms;
  final packaged CLI replay: 474 ms. These are small-copy verification timings, not
  incident/cutover RTO. No upgrade was performed on that copy. Temporary restore/test
  databases were checked absent after the tests; working records/archives were unchanged.
- Installed only the backup worker from `crm-app:backup-integrity-check` /
  `sha256:47c24ef7614820aef6f0170607a9b7d4639a34d2c6e150558ce611619c5c9868`.
  Its container is healthy. Web remains on the prior voice release and was not restarted;
  database/reminder containers were not recreated. A scheduled run with the new verifier
  has not yet occurred; isolated worker success/failure and actual-copy replay are the
  current evidence. The old worker's image ID was no longer taggable; the retained
  voice-release image contains the previous backup implementation and is tagged
  `crm-app:before-backup-integrity` for rollback. `crm-app:local` now points to the new image.
- IMPORTANT remaining: sequential database dump/file tar can race file removal, especially
  avatar replacement. Verification detects inconsistency but does not create a shared
  recovery point. Encryption/offsite export, tiered retention, independent scheduled drills,
  freshness alerts/timeouts and formal RPO/RTO are still required. Overall assessment
  reviewed and held at **6.7/10**; P0.3 is not closed.

## Remaining upload writers and installed acceptance — 2026-09-20

- Auditing the storage lifecycle found five additional paths that could remove a
  committed file after refresh failure, or remove evidence after an uncertain COMMIT:
  signed closing acts, visit photos, document templates, chat attachments and group
  avatars. The visit-photo EEXIST branch could also reach cleanup for another request's
  file. These were code-path risks; no working-company data loss was observed.
- All five actions now track file ownership and confirmed persistence separately.
  Known domain rejection cleans only this request's file; an unknown outcome retains
  bytes and gives an explicit verification instruction. A confirmed commit followed
  by failed revalidation returns saved state with `refreshRequired`. Dialogs retain
  that warning with disabled resubmission; chat shows the warning after clearing the
  confirmed sent draft. Unconfirmed drafts remain available. No permissions were widened.
- `test:upload-lifecycle`: 33 scenarios (34 TAP tests including parent), using real
  temporary files/action code and mocked repository/cache boundaries. Every refresh
  call is covered, plus known rejection, uncertain outcome and existing-file ownership.
  `test:finance-receipts`: 27 scenarios (28 TAP tests including parent) against real
  PostgreSQL 17/files. The new ten scenarios cover all five writers with both cache
  failure and an actual dropped server COMMIT acknowledgement. Independent reads
  verify references, bytes, visit completion and avatar version. Replays do not add
  another reference; stale avatar version is explicitly rejected, not silently accepted.
- Expanded standalone browser acceptance passed: 18 real form submissions and nine
  substituted saved-warning responses at 1440/390 px, persisted metadata/checksums,
  retained document versions and authorized downloads. Master uploads are followed
  by an office-session download and a master-session 403 check. The initial harness
  incorrectly expected the master to download archive versions; correcting the test
  preserved the application's permission boundary. No browser exceptions/console
  errors. Mobile act/photo warning screenshots were visually inspected. The browser
  substitution tests UI behavior, not a real cache/network failure; the separate
  action/PostgreSQL tests supply that evidence.
- Full lint/typecheck and 184 unit tests passed again. The clean production build
  `crm-app:upload-lifecycle-check` was tested through its extracted standalone runtime.
  Installed web image is `sha256:30f73d3a9449f146a447420036645d467e92c033b9d117859b01d81d0f7599d8`;
  healthcheck passed. Prior `76ceb8dc1d04` is retained as
  `crm-app:before-upload-lifecycle-20260920`. Database, reminder and backup container
  IDs did not change. All 54 working/source/candidate migration hashes matched;
  no migration was added. All 11 retained working files (4,462,390 bytes) passed
  reference/checksum verification before and after deployment. Live login/logout,
  home/documents/calendar/settings/chat/tasks navigation passed without browser
  exceptions or error overlays; no business records were changed by this smoke check.
- The task-scroll browser regression also passed again after installation at
  1600/390 px: independent wheel/keyboard scrolling, stationary group headings/page,
  no category navigation or Open-button SVG, and the completed-list overflow contract.
  Tests use existing task data without changing task records.
- CI includes the new action suite and expanded browser script; remote execution is
  still unverified. Overall assessment reviewed and held at **6.7/10**. This closes
  the five-writer corruption-risk substep, not P0.6/P0.3: file reconciliation,
  malware scanning, storage quotas, private object storage, recovery and remaining
  business acceptance are still open. Never delete an unreferenced file merely because
  it is old or absent from one snapshot: an in-flight transaction can still commit.

## Read-only storage reconciliation inventory — 2026-09-20

- Previous goal turn made verified progress: five upload-writer fixes were installed
  and accepted. This turn adds the first reconciliation stage, not automatic cleanup.
- Added `scripts/storage-audit.mjs` / `npm run storage:audit` and the operational
  [STORAGE_RECONCILIATION.md](STORAGE_RECONCILIATION.md) guide. It checks all four
  reference tables in a read-only repeatable-read transaction, verifies retained
  file metadata/bytes with the existing integrity verifier, and streams a bounded
  filesystem walk plus tenant-scoped lookups in batches of 100. It includes old
  versions, archived documents, inactive templates and deleted-message attachments.
- Missing/unreadable/corrupt references, linked/unexpected entries and files absent
  from the snapshot are explicit report records. No paths are deleted or changed.
  Unreferenced records say `safeToDelete: false`: a concurrent upload can still commit.
  The filesystem is not frozen; the report is diagnostic, not a coherent backup or
  deletion authorization. Exit codes distinguish clean completion (0), findings (2),
  and an incomplete/failed check (1). Mutation flags are rejected.
- `test:storage-audit` passed 12 scenarios (13 TAP tests including parent) against
  PostgreSQL 17/full current migrations, both locally and in the packaged non-root
  runtime. Tests cover all reference families, historical data, 105 old unreferenced
  files across batches, missing files, same-size corruption, links, output failure,
  CLI outcomes and a reference committed after the snapshot begins. In the concurrency
  test the first report marks the file unreferenced but not deletable; the next report
  recognizes the committed reference. Bytes remain untouched.
- Full lint/typecheck, 184 unit tests and clean production Docker build passed.
  Runtime image `crm-app:storage-audit-check` is
  `sha256:bf52f88e7270e8ffb5a7e67b33502b7c2bee6b6ed0ff42e4d4f8220ff62c252f`.
  The standalone packaging explicitly includes the operator script; CI tests the
  packaged implementation rather than mounting source over it. Remote CI remains
  unverified. No new dependencies, migrations, HTTP endpoints or role grants.
- Actual working-volume check at `2026-09-20T17:17:22.059Z`: 11 references/files,
  4,462,390 bytes, zero integrity failures/unreferenced files/unexpected entries.
  Used a separate one-shot container with a read-only filesystem/storage mount and
  reduced privileges; no web/database/worker restart or business-record mutation.
  Web remains healthy on `30f73d3a9449`; the utility image was not deployed as web.
- Assessment reviewed and held at **6.7/10**. Remaining lifecycle work includes
  coordinated writer drain and recoverable quarantine, explicit retention policy,
  private S3-compatible storage, content scanning and quotas. The clean inventory
  does not prove those requirements complete. Next implementation must preserve
  the original P0.6 object-storage scope, not replace it with local-disk tooling.

## Bounded reads across document endpoints — 2026-09-20

- The preceding task-scroll turn produced fresh browser evidence, not another UI
  implementation: wheel/keyboard scrolling is independent per group at 1600/390 px.
  This continuation returned to P0.6 and changed authoritative production code.
- Inspection found ordinary documents/versions/previews, templates, avatars and ZIP
  export still used unbounded `readFile`, validating size only after allocation.
  They now use the same bounded, checksum-verifying reader as chat attachments.
  The raw production `readDocumentFile` API and all its consumers were removed.
  Documents/templates remain capped at 15 MiB, avatars at 3 MiB; ZIP preflights
  every recorded size and its 50 MiB total before the first file read. Existing
  archive-content verification remains as a second check before successful audit.
- New `test:document-download` covers 19 scenarios (20 TAP tests including parent):
  real temporary files and actual route handlers, mocked session/repository boundary;
  401/403/404 before storage access, invalid/oversized sizes and checksums, same-size
  corruption, missing files, final-component symlinks, byte-exact successful downloads,
  real DOCX parsing/escaping, ZIP preflight and no successful audit on read failure.
  These are route-boundary tests, not new proof of database authorization rules.
  Passed locally and on Node 22 in a non-root read-only container. Added to CI;
  remote CI execution remains unverified.
- Full typecheck/lint, 184 unit tests, seven existing chat-download scenarios and
  27 real-PostgreSQL upload/receipt scenarios pass. Clean production Docker build
  passes. Extended isolated browser harness verifies current/historical document,
  template, avatar and ZIP response bytes in addition to the previous 18 upload
  submissions and nine simulated refresh-warning states. All pass at desktop/mobile
  widths with no browser errors; fresh-company HTTP smoke passes.
- Installed only web image `crm-app:bounded-file-read-check`, reported by Docker as
  `sha256:7e2f16ab7092ecacb5a1859e4af2d25a7a9aebc983e62a05885e943680e03954`.
  Rollback: `crm-app:before-bounded-file-read-20260920` (previous `30f73d3a9449`).
  All 54 source/image/working migration checksums matched before installation;
  effective environment matched. Database and both workers were not recreated.
  Working-volume audits before/after verified the same 11 references/files and
  4,462,390 bytes, no missing/corrupt/unreferenced/unexpected files. Four existing
  historical document downloads returned exact recorded sizes/checksums; anonymous
  requests were denied. Web health passes; no business files or metadata were changed.
  Post-install task-group scrolling passes again at 1600/390 px. Disposable browser
  database/storage and the extracted test runtime were removed; release/rollback
  images and test screenshots remain available.
- Assessment reviewed and held at **6.7/10**. This removes an unsafe read path, not
  the remaining P0.6 scope: private S3 storage, safe migration/rollback, coordinated
  backup, scanner, quotas and cleanup. Per-file allocation bounds also do not prove
  aggregate concurrency limits or bounded DOCX decompression; those remain acceptance
  work rather than being hidden behind these passing tests.

## Explicit S3 backend and coordinated backup path — 2026-09-20

- Previous continuation was concrete progress: bounded reads were implemented,
  tested and installed. This continuation implements the actual object-storage
  backend rather than replacing P0.6 with more local-only tooling.
- Added pinned official `@aws-sdk/client-s3` 3.1136.0. Shared Node modules serve both
  application and worker: explicit S3 configuration, generated-key validation,
  exclusive conditional PUT with SHA-256, bounded streamed GET/checksum verification,
  cancellation through the response body, and DELETE. Credentials remain server-side.
  Public handler authorization is unchanged. No local fallback on S3 failure.
- Writes/deletes have one attempt: an unacknowledged write is not silently retried,
  overwritten or deleted. Reads may attempt twice within the same deadline. The real
  fixture exposed a stale-connection read immediately after a rejected duplicate PUT;
  separated read/mutation clients and bounded read retry address that without
  making uncertain writes retryable. Eight S3 scenarios (nine TAP including parent)
  pass: private anonymous access, byte/hash checks, duplicate/concurrent writes,
  corruption, missing/unauthorized objects, invalid input, deletion, stalled response
  and dropped write acknowledgement. Two configuration tests bring unit total to 186.
- Backup worker consumes verified S3 objects under the existing PostgreSQL reference
  locks, stages them privately, and uses the same exported-snapshot/archive/restore
  path. A real packaged-worker test restores a full 54-migration DB with document
  history, template, deleted-message attachment and avatar; then removes a remote
  object and requires failure/no new exported archive even with valid local bytes.
  S3-enabled backup suite: 19 scenarios / 20 TAP; local regression: 18 / 19 TAP.
- Production image `crm-app:s3-check` is
  `sha256:61ef8e39a11f0d14167f97b5cd84aed00e8a7dba0ac55d98aaafc757d1018f5f`.
  Built cleanly; packaged storage/config/backup modules import successfully. The
  extracted standalone application passed full upload browser acceptance in BOTH
  S3 and local modes: 18 submissions per mode, nine injected refresh-warning states,
  historical/current/template/avatar downloads and ZIP checks, no browser errors.
  S3 mode wrote no local upload files; snapshot staging verified all four families.
  These use isolated databases and random private RAM-backed S3 buckets, not user data.
- Full typecheck/lint, 186 unit tests, document/chat download suites, 38 upload-commit,
  33 upload-lifecycle and 27 real-PostgreSQL receipt/upload scenarios pass. Dependency
  audit reports zero vulnerabilities. CI now declares S3 contract, browser and packaged
  backup checks; remote CI remains unverified. No migrations or role grants added.
- Updated configuration/runbooks and added `docs/OBJECT_STORAGE.md`. Current local
  inventory explicitly rejects S3 mode, avoiding a false clean report against an
  unrelated local directory; a real S3 inventory remains open. The pinned archived
  MinIO image is only a disposable compatibility fixture, not a production recommendation.
- Working web remains `crm-app:bounded-file-read-check` (`7e2f16ab7092`), healthy;
  neither web nor database/workers were replaced during this continuation. No working
  file migration has occurred. Assessment reviewed and held at **6.7/10** until
  writer-drained migration/rollback and provider acceptance are proven. Still open:
  production provider policy/TLS/encryption validation, coordinated migration,
  S3 reconciliation, malware scanning, quotas, encrypted offsite recovery and load gates.

## Remaining acceptance work

Each row retains the original plan's scope. An unchecked item is unproven, even where code exists.

| Plan requirement | Status / next evidence needed |
| --- | --- |
| P0.1 Perimeter | Explicit origins/hosts, proxy trust, nonce CSP, isolated HTTPS, bounded JSON, search and chat send/upload budgets verified. Remaining: complete upload/CSRF audit, other chat/file/integration quotas, load acceptance, certificate renewal/alerts. Public domain/server acceptance excluded for now. |
| P0.2 Secrets/configuration | Startup guard and negative process tests implemented. Still need separate environments, rotation/revocation rehearsal, least-privilege DB role and image/log secret checks. |
| P0.3 Backup/recovery | All retained file references verified; actual copy restored independently with counts/timing. Remaining: coordinated encrypted DB+file snapshots, offsite adapter, daily/weekly/monthly retention, independent scheduled drills, freshness alerts and formal measured RPO/RTO. |
| P0.4 Observability | Structured redacted logs, request IDs, client/server/worker error capture, metrics and actionable alerts. |
| P0.5 CI/CD | Initial checks added; still need critical business integration flows, actual CI/required-check evidence, previous-release upgrade, reproducible deploy/rollback rehearsal. |
| P0.6 Storage | Private object storage, content scanning, authorized download, checksums/versioning/lifecycle and recovery coordination. |
| P0.7 Runbook | Write and rehearse every incident from section 4; record results rather than merely listing commands. |
| P1.1 Authorization | Full operation/role matrix and negative resource/organization/deactivation tests. |
| P1.2 Pagination/performance | Cursor/filter/sort contracts, bounded registries, N+1 audit, measured queries and reports. Removing a UI slice is not server-side pagination. |
| P1.3 Errors/states | Global boundaries, safe error contracts, retry and form-input preservation; audit silent fallbacks. |
| P1.4 Realtime | Chat, reactions/read state, presence, notifications and scheduling with resource-level authorization. |
| P1.5 Background work | Queue, idempotency, timeout, bounded retry, dead-letter and audited replay. |
| A Intake | Source integration, deduplication, owner/SLA/escalation, conversion and loss reasons; measured response metrics. |
| B Orders/assignment | Canonical statuses, transition rules, required fields, suitability, concurrent schedule conflicts and audited changes. |
| C Field visit | Mobile/network interruption, checklist/photos, start/pause/complete, outcome and closing-document flow. |
| D Documents/finance | Historical values, versions, renewal chains, expiry risk, invoices/payments/expenses, receivables and exceptions. |
| E Repeat business | Next need, owner reminder, object history, repeat-contact segment and conversion. |
| UX | Role-specific home/action flows, keyboard/contrast/responsive checks and five observed employee scenarios. |
| Owner analytics | KPI dictionary/formulas/owners/thresholds/actions and consistent business data; remaining chart semantics audit. |
| Chat hardening | Authorized live card resolution, search/pagination, field allowlists, replies/forwarding/pins/read receipts/mentions, retention and batch resolution. |
| Workflow | Preserve section 10's explicit exclusion of full implementation until product approval. |
| Business pilot | Real product/process owner, baseline, staff training, issue log, parallel-process retirement and 30/60/90-day measurement. Requires actual company participation; cannot be proven with generated fixtures. |
| Launch gates / DoD | Requirement-by-requirement final audit of sections 13 and 15, including both technical and organizational evidence. |

## Verification commands

Run from this repository root:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
npm run test:migrations
npm run test:request-limits
```

These npm commands provision an isolated disposable PostgreSQL container. The migration suite
creates randomly named `crm_migration_test_*` databases inside it and drops only databases it created.
The runtime smoke suite expects a fresh company and explicit test credentials; do not point
it at a user's working company. CI generates temporary credentials and uses a disposable service.
