# Application request limits

These are protective request budgets, not paid-plan quotas or measured capacity claims.
They supplement the gateway limits in `docs/HTTPS_DEPLOYMENT.md`.

## Global search

`GET /api/v1/search` admits up to 120 requests per member and 1200 per organization
in separate 60-second windows. These initial thresholds live in
`src/server/request-limits/repository.ts`; tune them only after a representative
load test and operational monitoring. Search debounce is not a security boundary.

- Authentication, `search.use` authorization and query validation happen first.
- The member budget is charged before the organization budget. A blocked member
  cannot continue exhausting the shared organization budget. An organization denial
  still consumes the otherwise eligible member's attempt.
- Budgets are independent of session, query text, browser tab and claimed IP address.
  Separate application processes share PostgreSQL counters.
- Fixed windows begin on the first request, using database time. A window can allow
  a burst around its boundary; this is not a sliding-window or concurrency limiter.
- Each update is an atomic upsert. Counters saturate at the limit plus one; denied
  traffic does not extend the window. Expiry resets the existing row.
- The nullable member key represents the organization bucket. A `NULLS NOT DISTINCT`
  unique constraint prevents duplicate organization counters. Tenant/member foreign
  keys prevent cross-company identities, and cascade removes obsolete counters.
- Rows are bounded by members/organizations and the finite server-defined operations,
  not arbitrary user input or time windows. Queries and IP addresses are not stored.
- Denials return `429`, `Retry-After` in seconds, `private, no-store` and the normal
  JSON error envelope. The search dialog preserves the query and offers manual retry.
- Database failure propagates to the route's `503`; it never grants unlimited search
  or returns an invented empty result. Explicit preview mode has no database budget.

The new table is added by `054_request_rate_limits.sql`; existing business tables
and login/webhook counters are unchanged. Do not edit already-applied migrations.

## Verification

Only use a disposable test database:

```sh
MIGRATION_TEST_ADMIN_URL=postgresql://postgres@127.0.0.1:TEST_PORT/postgres npm run test:request-limits
```

Eight integration scenarios run the real limiter through two PostgreSQL connection
pools: concurrent member cap, shared organization cap and tenant isolation, expiry,
independent chat message/upload/download budgets, foreign-key/cascade behavior, and fail-closed storage errors. The script creates and
drops only its randomly named test database.

`scripts/search-limits-check.mjs` runs against a fresh standalone smoke company,
with `SMOKE_BASE_URL`, `DATABASE_URL` and disposable bootstrap credentials. It changes
only fixtures in a `crm_smoke_<random>` / `crm_ci` database, never a working company.
It checks authorization before budget consumption, concurrent sessions/forged IPs,
company denial, HTTP contracts, recovery and the browser dialog at 1440/390 px.
Browser captures are under `artifacts/production/search-limit-*.png`.

CI defines both checks. Actual remote CI execution remains unverified.

## Chat messages and uploads

`sendChatMessageAction` now applies separate 60-second PostgreSQL budgets:

| Operation | Per member | Per organization |
| --- | ---: | ---: |
| Message send attempts | 60 | 600 |
| Attachment or channel-avatar uploads | 10 | 100 |

These use the same counter semantics as search, with independent operation keys.
Channel membership, tenant, active-channel status and permissions are checked before
budget consumption or file reads/writes. Avatars additionally require an editable
office group and the expected version. The final repository mutation checks access
again; the upload preflight does not replace transaction-level authorization.
Confirmed idempotent message retries return the existing message without another
upload or budget charge. An upload attempt consumes the eligible message budget
before checking the upload budget, even when the latter denies it.

Denials are explicit Server Action error states with a retry delay, not HTTP 429
contracts. The composer preserves text, selected file, shared entity and request key
on returned errors; it resets only on confirmed success. Its channel-based identity
also prevents incoming-message refreshes from discarding the draft. This is in-memory
preservation, not persistence across page reloads or channel changes.

`test:chat-send` checks seven actual-action scenarios with mocked boundaries,
including rejection before file allocation/storage. `test:chat-access` checks six
real-repository scenarios on an isolated migrated PostgreSQL database: tenant and
membership isolation, permissions, archive/removal after preflight, idempotency,
system/direct avatar restrictions and version conflicts. It drops only its own
randomly named `crm_chat_access_test_*` database.

`scripts/chat-limits-check.mjs` uses the disposable smoke/CI database and real browser:
member/company denials for both operations, unchanged storage on denial, text/file/key
preservation, retry success, incoming-message refresh and a forged channel ID.
1440/390 px captures live under `artifacts/production/chat-*.png`. Voice recording,
pause/resume, preview and draft deletion are separately checked by the existing voice
flow; that check does not send a voice attachment. CI includes these checks.

Important boundary: Next.js parses multipart FormData before the action runs. These
checks prevent the additional attachment buffer allocation and storage write, not
initial multipart parsing. Existing gateway/Server Action body caps still apply.
Request counts are not byte, disk-capacity, concurrency or malware-scanning controls.

## Chat attachment downloads

`GET` and `HEAD /api/v1/chat/attachments/[id]/download` have independent budgets of
300 requests per member and 3000 per organization per 60-second window. Authentication,
`chat.read`, organization, channel membership and a non-deleted message are required
before charging the budget. Malformed attachment IDs return 404. Budget storage failure
returns 503; denials return 429 with `Retry-After` and private/no-store headers.

The reader validates recorded size (at most 15 MiB), opens a regular non-symlink file,
allocates only the validated size, and verifies SHA-256 before returning any bytes.
Single byte ranges support 206/416, open-ended and suffix requests. HEAD ignores Range;
strong checksum ETags support If-Range/If-Match and conditional If-None-Match requests.
Unsupported multipart ranges and unknown units are intentionally ignored. HTTP behavior
follows [RFC 9110 Range](https://www.rfc-editor.org/rfc/rfc9110.html#section-14.2).
Only successful GET responses create the existing download audit event; this records
dispatch, not proof that the client received every byte.

`test:chat-download` passes seven route/storage scenarios. The PostgreSQL
limiter suite passes eight scenarios. The disposable standalone browser/HTTP check
`scripts/chat-download-flow-check.mjs` verified a real uploaded WAV at 1440/390 px,
play/pause/seek, ranges and conditions, member/company denials, resource isolation,
corruption outside the requested range, and recovery. Its extension to a real recorded
voice first exposed infinite WebM duration. After the fix, recording/pause/resume,
injected preparation failure with retained draft/retry, preview, sending, page reload
and persisted voice playback/seek all pass. CI includes the regression; remote CI
execution remains unverified. This release is installed in the local web container.

Limits remain per-request counts, not byte/concurrency limits. Each request hashes the
entire bounded file, including HEAD/conditional/range requests; this is not zero-copy
streaming or a global memory budget. Other document readers are not migrated by this change.

### Recorded voice duration

The browser finalizes its own completed MediaRecorder WebM before preview/upload.
Duration excludes pauses. The narrowly scoped `recorded-voice.ts` helper uses exact
`@fix-webm-duration/fix` and `@fix-webm-duration/parser` 1.0.1 dependencies (MIT), loaded
only when needed. Binary EBML normalization warrants a format-specific parser rather
than a custom byte patch. The parser/fixer source was inspected; the high-level wrapper
which silently returns the input on failure is not used. Missing/incompatible metadata,
invalid duration and over-limit files produce an explicit preparation error. The raw
draft remains available for retry; cancellation invalidates pending preparation.

MP4 is not rewritten as WebM. Arbitrary uploaded files and previously stored files
are not passed to the normalizer. Server size/type/signature/access checks remain the
authority; client finalization is not upload validation or malware scanning. The recorder
still needs long-recording/memory-cap acceptance and real Safari/Firefox microphone tests.

For old WebM files without duration metadata, the player displays unknown duration,
does not assign Infinity to `currentTime`, and enables seeking once duration is known
(verified after first complete playback). Existing bytes/checksum stay unchanged.
Seeking old files before their first full playback is not claimed solved. The browser
regression verifies that legacy playback and download preserve the original bytes.

Deleting a ready voice draft also clears its hidden upload input. A separate cancellation
test delays preparation, deletes the draft and releases the delayed read: no preview or
upload file reappears. These are in-memory guarantees, not draft recovery after reload.

## Remaining scope

The new chat budgets cover message sends, attachment/avatar uploads and
attachment downloads, not channel creation, reactions, message reads, other-domain files,
exports or integrations.
Login and website leads retain their existing dedicated limits. Remaining operation-specific limits,
upload byte budgets, concurrent job limits, telemetry and realistic load acceptance
remain required before declaring P0.1 complete.

## Rolling application code back across migration 054

The previous code does not use the additive table and can run against schema 054.
However, its image only includes migrations through 053. The migration-history guard
correctly refuses to start that image with its old migration directory.

For this specific compatible rollback, keep schema 054 and give the previous image
the current release's complete, checksum-matching migration directory as a read-only
mount at `/app/db/migrations`. Keep the normal entrypoint and runtime validation.
Do not delete the table/history, bypass the guard, or assume future migrations are
also backward compatible. Restore the current image to re-enable search protection.

`scripts/rollback-smoke-check.mjs` rehearses this with `CRM_ROLLBACK_IMAGE`, a disposable
`crm_smoke_<random>` database and a temporary container on loopback port 3110. It checks
normal startup, unchanged migration history, login, tasks, clients and search; it is
not a complete business-flow rollback acceptance. It removes its own container afterward.
