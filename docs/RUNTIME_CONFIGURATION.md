# Runtime configuration

The web process validates configuration before handling application requests.
The Docker entrypoint runs the same validation **before migrations**. Both
background workers validate their own required settings before a database
connection, storage client, or file operation. A failure exits with code 1
and names the invalid setting, never its value. Building an image does not
require production credentials.

| Setting | Contract |
| --- | --- |
| `AUTH_MODE` | Explicit `required` for working deployments. `preview` is exclusively an intentional UI demonstration with no authenticated company access. Production has no implicit mode. |
| `DATABASE_URL` | Required in authenticated mode. PostgreSQL URL with hostname and database name. Database availability is checked by health checks, not inferred from a valid URL. |
| `AUTH_THROTTLE_SECRET` | Required in authenticated mode. At least 32 characters, no surrounding whitespace or example placeholder. Generate independently for each environment. This validation cannot prove entropy. |
| `DOCUMENT_STORAGE_BACKEND` | `local` (existing default) or `s3`. Changing it is a storage migration, not a harmless configuration toggle. See [object storage](OBJECT_STORAGE.md). |
| `DOCUMENT_STORAGE_ROOT` | Required absolute private path for authenticated production in local mode; validated whenever supplied. On Windows use a Windows absolute path; on Linux/macOS use an absolute POSIX path. Directory access and disk capacity still require operational monitoring. |
| `DOCUMENT_S3_*` | S3 mode requires HTTPS endpoint, region, bucket and server-side credentials; path-style and bounded timeout are explicit optional settings. Invalid configuration fails startup; network failures do not fall back to local disk. See [object storage](OBJECT_STORAGE.md) for all fields and migration gates. |
| `AUTH_COOKIE_SECURE` | If specified, exactly `true` or `false`. Defaults to true in production. False is only for a trusted local HTTP stand. Public deployment requires TLS and true. |
| `CRM_ALLOWED_ORIGINS` | Required for authenticated production: comma-separated explicit HTTP(S) origins, including nonstandard ports. No wildcards, credentials, paths, fragments or query strings. Unsafe browser requests without a matching Origin are rejected. |
| `CRM_TRUST_PROXY` | Exactly `true` or `false`; false unless explicitly configured. True only behind the private HTTPS ingress that overwrites client-IP headers. Authenticated production with proxy trust requires HTTPS origins and secure cookies. |
| `CRM_BIND_ADDRESS` | Base local Compose bind defaults to `127.0.0.1`. Use the HTTPS override for a public deployment, not an exposed local HTTP stand. |
| `CRM_WEBSITE_WEBHOOK_SECRET` | Empty or omitted disables public website intake. When configured, the same minimum secret requirements apply. Use a distinct secret, never the authentication-throttle key. |

For a local configuration preflight, run:

```sh
NODE_ENV=production node --env-file=.env.local --experimental-strip-types scripts/validate-runtime-config.mjs
```

No database connection or migration is performed by that command. Docker supplies
its own `/app/storage` path, so check the actual deployment environment rather
than copying a host-specific Windows path into a Linux container.

`next start` and the generated standalone server are also guarded by the
instrumentation hook. Next.js 16.3.5 can log `Ready` before an asynchronous startup
failure and leave a rejected hook's process alive; the hook explicitly terminates
on invalid configuration. A log line is not a readiness check. Require a running
process and a successful health check after deployment.

`/api/v1/system/live` reports that the web process can answer HTTP without
touching PostgreSQL. `/api/v1/system/ready` checks PostgreSQL and reports 503
when it is unavailable. The existing `/api/v1/system/health` remains a
compatibility alias for readiness, including the current worker heartbeat
summary. All three responses use `Cache-Control: no-store`; readiness errors
are logged by category without raw database error text. The Docker healthcheck
still uses `/health`. Storage/S3 access and backup freshness are not yet
readiness dependencies and need separate acceptance/monitoring.

Verification:

```sh
node --test scripts/runtime-config.test.mjs
npm run build
npm run test:startup
```

The first suite covers required/optional settings, malformed URLs, copied example
secrets, redacted failures and validation before migrations. The second launches
the real standalone server without each mandatory setting and requires a prompt
nonzero exit. The authenticated isolated smoke suite covers a valid startup.

`scripts/worker-runtime-config.mjs` applies worker-specific startup checks:
both workers require a PostgreSQL URL with a host, user and database. The
reminder worker also validates its bounded interval. The backup worker validates
schedule/retention bounds, the selected local/S3 backend, required S3 settings,
and absolute storage/backup/export paths. `npm test` includes actual worker
process starts with invalid settings and checks that the diagnostic does not
print the database password. On 2026-09-23, both packaged workers also passed
healthcheck against the working local database and rejected an empty URL before
connecting; the updated workers were installed and remained healthy.

Remaining P0.2 work includes least-privilege database identities, enforced
environment separation, credential rotation/revocation rehearsal, and image/log
secret scanning. This startup guard does not claim those are complete.

See [HTTPS deployment](HTTPS_DEPLOYMENT.md) for the opt-in ingress, certificate
handling, proxy trust boundary, initial limits and disposable acceptance test.
