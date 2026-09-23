# HTTPS ingress

The base `compose.yaml` is a local HTTP stand bound to loopback. Public deployment
uses **both** `compose.yaml` and `compose.https.yaml` (Docker Compose 2.24.4+).
The HTTPS override removes published application and PostgreSQL ports. Only the
gateway accepts host traffic; authenticated production trusts proxy headers only
on this private network. Do not attach untrusted containers or publish the app port.

The gateway replaces `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Host` and
`X-Forwarded-Proto`, and removes `Forwarded`. The application uses only the validated
`X-Real-IP` when `CRM_TRUST_PROXY=true`. A CDN or another load balancer in front
requires a separate, explicit trusted-hop configuration; do not simply start
accepting arbitrary forwarded headers.

## Configuration

Supply the normal database/authentication settings plus these environment values:

```dotenv
CRM_PUBLIC_ORIGIN=https://crm.example.com
CRM_PUBLIC_HOST=crm.example.com
CRM_TLS_CERTIFICATE=/absolute/private/path/fullchain.pem
CRM_TLS_PRIVATE_KEY=/absolute/private/path/private-key.pem
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
Do not expose the base local HTTP deployment as a production service.

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.https.yaml up -d --build --wait
```

The override forces secure cookies, trusted-proxy mode and the configured origin.
Startup rejects HTTP origins or insecure cookies in authenticated trusted-proxy
production. Plain HTTP redirects to the configured HTTPS origin, never a supplied
Host. TLS supports 1.2/1.3 only; HSTS is applied without preloading or extending it
to unrelated subdomains. Certificates must be renewed before expiry. After replacing
mounted certificate files, recreate the gateway so the new files are mounted and loaded:

```sh
docker compose --env-file .env.production -f compose.yaml -f compose.https.yaml up -d --force-recreate --no-deps gateway
```

Automated issuance/renewal and expiry alerts are not implemented yet. The gateway's
container health check validates nginx configuration; external HTTPS monitoring is
still required and is not proven by `nginx -t`.

## Limits

- All request bodies: at most 16 MiB at ingress; login API and login Server Action:
  32 KiB. Application-level validation and file-specific limits remain necessary.
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
rate limiting. The browser ignores the self-signed certificate only after the Node
HTTPS client has verified it with its explicit CA; TLS verification is not globally
disabled. The test removes only its own project volumes and temporary files.

This rehearsal does not prove real certificate renewal, public DNS/firewall rules,
offsite recovery, high availability, or the remaining production launch gates.

Primary references: [nginx proxy headers](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[TLS directives](https://nginx.org/en/docs/http/ngx_http_ssl_module.html),
[request limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[Compose merge/reset](https://docs.docker.com/reference/compose-file/merge/).
