# HTTPS ingress

`compose.yaml` is the local HTTP stand and uses local working volumes. Server
deployment uses **only** the standalone `compose.production.yaml`; never merge
it with `compose.yaml`. It has its own `crm-production` project, PostgreSQL,
document and backup volumes, private network, required ClamAV and separate
service environment files. Only the HTTPS gateway publishes host ports. The
local CRM and its data are not inputs to this configuration.

The gateway replaces `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host` and
`X-Forwarded-Proto`, and removes `Forwarded`. The application uses only the validated
`X-Real-IP` when `CRM_TRUST_PROXY=true`. A CDN or another load balancer in front
requires a separate, explicit trusted-hop configuration; do not simply start
accepting arbitrary forwarded headers.

## Configuration

Copy the five `.env.production*.example` files to names without `.example`,
replace every placeholder and restrict their permissions. `.env.production`
is used for Compose interpolation; `.env.production.database`, `.web`,
`.workers` and `.backup` are passed only to their corresponding services.
The web authentication secret is not sent to the database or workers. The
interpolation file contains these deployment settings:

```dotenv
CRM_PUBLIC_ORIGIN=https://crm.example.com
CRM_PUBLIC_HOST=crm.example.com
CRM_APP_IMAGE=crm-app:release-candidate
CRM_TLS_CERTIFICATE=/absolute/private/path/fullchain.pem
CRM_TLS_PRIVATE_KEY=/absolute/private/path/private-key.pem
CRM_BACKUP_EXPORT_PATH=/absolute/private/backup-export
CRM_HTTPS_BIND_ADDRESS=0.0.0.0
CRM_HTTP_PORT=80
CRM_HTTPS_PORT=443
```

`crm.example.com` is an example, not an assigned domain. The origin must match the
certificate and include a nonstandard public port when used. `CRM_PUBLIC_HOST` is
the hostname without a port; the gateway rejects a different Host. The certificate chain
and private key must already exist; they are mounted read-only, never copied into
the image. Keep the private key outside the checkout with owner-only permissions.
The default bind is loopback; opening it publicly is an explicit operator choice.
Create the private backup export directory on the server before starting;
Compose will not create a missing host path. It must be outside the checkout
and separate from the Docker volumes. Keep the four service env files out of
Git and use distinct production secrets and database credentials. A database
password embedded in `DATABASE_URL` must be URL-encoded if it has reserved
characters.

```sh
npm run test:production-compose
docker build -t crm-app:release-candidate .
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --wait
```

The production file forces secure cookies, trusted-proxy mode, the configured
origin and mandatory file scanning. Web, reminder, Workflow and backup worker
use the same explicitly named release image. The web service waits for
PostgreSQL and ClamAV startup; its readiness requires the scanner to answer.
Budget roughly 1 GiB for ClamAV itself before choosing a server size.
Startup rejects HTTP origins or insecure cookies in authenticated trusted-proxy
production. Plain HTTP redirects to the configured HTTPS origin, never a supplied
Host. TLS supports 1.2/1.3 only; HSTS is applied without preloading or extending it
to unrelated subdomains. Certificates must be renewed before expiry. After replacing
mounted certificate files, recreate the gateway so the new files are mounted and loaded:

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d --force-recreate --no-deps gateway
```

After first startup has applied migrations, create the first owner account
with a separate private `.env.production.bootstrap` file containing only
`AUTH_BOOTSTRAP_ORGANIZATION_NAME`, `AUTH_BOOTSTRAP_TIMEZONE`,
`AUTH_BOOTSTRAP_ADMIN_NAME`, `AUTH_BOOTSTRAP_ADMIN_EMAIL` and
`AUTH_BOOTSTRAP_ADMIN_PASSWORD`. Set `AUTH_BOOTSTRAP_DEVELOPER=true` in that
file when the account must have the protected Developer role. Use the owner's
real email; no personal email is hardcoded in the release image. Do not put
these values in shell command
arguments or the ongoing web/worker env files:

```sh
docker compose --env-file .env.production -f compose.production.yaml run --rm --no-deps --env-from-file .env.production.bootstrap --entrypoint node crm --experimental-strip-types scripts/create-admin.ts
```

The release image contains this command. It refuses a duplicate email and
creates the company and owner in one database transaction. The developer role
is registered in the same transaction and cannot be assigned, deactivated,
edited or password-reset through CRM organization settings. Protect
or remove the bootstrap file after use.

For a disposable rehearsal of this exact production Compose file on a machine
with the candidate image, run:

```sh
CRM_PRODUCTION_CHECK_IMAGE=crm-app:release-candidate npm run test:production-stack
```

The script uses temporary env files, random credentials, a one-day localhost
certificate and a random Compose project name. It starts all seven services,
creates an administrator from the packaged command, verifies HTTPS login and
removes only its own containers, volumes and temporary files. It does not
replace checks on the chosen server, DNS, certificate renewal or offsite backup.

Automated issuance/renewal and expiry alerts are not implemented yet. The gateway's
container health check validates nginx configuration; external HTTPS monitoring is
still required and is not proven by `nginx -t`.

## Limits

- All request bodies: at most 16 MiB at ingress; login API and login Server Action:
  32 KiB. Application-level validation and file-specific limits remain necessary.
- Requests with bodies share four concurrent gateway permits before Next.js
  receives a body; a fifth returns 429. This includes POST/PUT/PATCH/DELETE,
  and GET/HEAD with an explicit Content-Length or Transfer-Encoding header.
  Requests without a body, including health checks, remain available.
  The configured body buffer is 64 KiB; larger bodies spill to
  `/var/cache/nginx/client_temp`, with a 30-second gap
  timeout while reading. The spill directory is an 80 MiB tmpfs, writable by
  the nginx worker, so these bodies cannot fill the container's writable disk.
  Four maximum-sized bodies can occupy roughly 64 MiB, leaving
  headroom for metadata. Tmpfs uses container/host memory
  and may use swap; monitor that budget on the chosen server.
  Nginx removes temporary files after processing. Response buffering is off,
  so large document responses do not spill into the gateway's writable layer.
- Login POSTs: 5/min per source IP with burst 5; generic dynamic traffic: 20/s with
  burst 80. Static Next.js chunks are exempt. Denials return 429.
- These are initial ingress limits, not a complete per-member/organization quota
  system. Shared office IPs can hit the same bucket. Tune using measured traffic;
  do not remove the application's identity-based login throttle.
- TLS terminates at the gateway; gateway-to-app traffic stays on the private Docker
  network. Never enable proxy trust on a publicly reachable app port.

## Disposable local acceptance test

Requires Docker, OpenSSL, Node.js, dependencies and Playwright Chromium. No purchased
domain, system certificate installation or changes to the working company are needed.

```sh
docker build -t crm-app:tls-check .
npm run test:tls
```

Set `CHROME_PATH` if using a system Chrome instead of Playwright's downloaded browser.
The test uses a standalone Compose fixture with the same checked-in nginx template;
it creates a random project, disposable database/storage, test account
and one-day localhost certificate. It checks resolved port isolation, certificate
verification, TLS protocols, redirects, secure cookies, login via Server Action,
unsafe return URLs, host/origin rejection, body limits and spoof-resistant ingress
rate limiting. It also holds four incomplete multipart bodies, verifies that
multipart, JSON and GET-with-body requests all receive 429 while a bodyless
health check stays available. It checks the 80 MiB tmpfs mount, fills over
48 MiB of it and verifies release after disconnect. The document form retains
its file, fields and retry key before a successful retry. A real 15 MiB PDF
passes through the gateway and a paused-client download with matching length
and SHA-256.
The browser ignores the self-signed
certificate only after the Node HTTPS client has verified it with its explicit
CA; TLS verification is not globally disabled. The test removes only its own
project volumes and temporary files.

This rehearsal does not prove real certificate renewal, public DNS/firewall rules,
offsite recovery, high availability, or the remaining production launch gates.

Primary references: [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[TLS directives](https://nginx.org/en/docs/http/ngx_http_ssl_module.html),
[request limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[concurrent connection limits](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html),
[proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering),
[Docker tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/),
[Compose merge/reset](https://docs.docker.com/reference/compose-file/merge/).
