import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.SMOKE_BASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!baseUrl || !identity || !password) throw new Error("SMOKE_BASE_URL and bootstrap test credentials are required.");
const origin = new URL(baseUrl).origin;

async function request(path, { cookie, ...options } = {}) {
  return fetch(new URL(path, origin), {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  });
}

const health = await request("/api/v1/system/health");
assert.equal(health.status, 200, "Production app must reach PostgreSQL");
const healthState = await health.json();
assert.equal(healthState.database, "available");
assert.equal(healthState.storage, "available");
assert.equal((await request("/api/v1/system/live")).status, 200);
const readiness = await request("/api/v1/system/ready");
assert.equal(readiness.status, 200);
const readinessState = await readiness.json();
assert.equal(readinessState.database, "available");
assert.equal(readinessState.storage, "available");
for (const path of ["/api/v1/auth/session", "/api/v1/search?q=customer", "/api/v1/notifications"]) {
  assert.equal((await request(path)).status, 401, `${path} must require authentication`);
}
const protectedPage = await request("/clients");
assert.ok([303, 307].includes(protectedPage.status), "Protected page must redirect to login");
assert.equal(new URL(protectedPage.headers.get("location"), origin).pathname, "/login");

const loginPayload = JSON.stringify({ identity, password });
assert.equal((await request("/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://untrusted.invalid" },
  body: loginPayload,
})).status, 403, "Cross-origin login must be rejected");
const login = await request("/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: loginPayload,
});
assert.equal(login.status, 200, "Valid account must be able to sign in");
const setCookie = login.headers.get("set-cookie");
assert.ok(setCookie, "Sign-in must issue a session cookie");
assert.match(setCookie, /httponly/i);
assert.match(setCookie, /samesite=lax/i);
const cookie = setCookie.split(";", 1)[0];
try {
  const session = await request("/api/v1/auth/session", { cookie });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).data.email, identity);
  for (const path of ["/", "/clients", "/orders", "/tasks", "/finance", "/documents", "/contracts", "/analytics"]) {
    const page = await request(path, { cookie });
    assert.equal(page.status, 200, `${path} must render for a fresh company`);
    const html = await page.text();
    assert.doesNotMatch(html, /NEXT_HTTP_ERROR_FALLBACK;500|data-next-error-message=/, `${path} must not hide a streamed rendering failure`);
  }
  for (const suffix of ["", "?data=example"]) {
    const analytics = await request(`/analytics${suffix}`, { cookie });
    assert.equal(analytics.status, 200);
    assert.match(await analytics.text(), /За выбранный период нет согласованных услуг\./, "An empty company must not receive invented analytics, even via a query parameter");
    const sites = await request(`/sites${suffix}`, { cookie });
    assert.equal(sites.status, 200);
    const html = await sites.text();
    assert.match(html, /Сайты ещё не добавлены\./);
    assert.doesNotMatch(html, /Городская дезслужба|dez-control\.ru/, "Production must not substitute the demonstration portfolio");
  }
  const demoSite = await request("/sites/site-1", { cookie });
  const demoSiteHtml = await demoSite.text();
  assert.ok(demoSite.status === 404 || demoSiteHtml.includes("NEXT_HTTP_ERROR_FALLBACK;404"), "Demo-only site identifiers must be not found in required-auth mode");
  assert.doesNotMatch(demoSiteHtml, /Городская дезслужба/);
  assert.equal((await request("/api/v1/auth/logout", {
    method: "POST", cookie, headers: { origin: "https://untrusted.invalid" },
  })).status, 403, "Cross-origin logout must be rejected");
  assert.equal((await request("/api/v1/auth/session", { cookie })).status, 200, "Rejected logout must preserve the session");
} finally {
  assert.equal((await request("/api/v1/auth/logout", { method: "POST", cookie })).status, 200);
}
assert.equal((await request("/api/v1/auth/session", { cookie })).status, 401, "Logout must revoke the server-side session, including a copied cookie");
const unknownIdentity = `throttle-${randomUUID()}@example.invalid`;
const failedLogin = () => request("/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ identity: unknownIdentity, password: "invalid-test-password" }),
});
const attempts = await Promise.all(Array.from({ length: 11 }, failedLogin));
assert.equal(attempts.filter((response) => response.status === 401).length, 10, "The shared throttle must admit exactly ten concurrent attempts");
assert.equal(attempts.filter((response) => response.status === 429).length, 1, "A concurrent request beyond the limit must be denied");
for (const response of attempts) {
  assert.equal(response.headers.get("set-cookie"), null, "Rejected login must not create a session");
  const payload = await response.json();
  assert.equal(payload.error.code, response.status === 429 ? "rate_limited" : "invalid_credentials");
}
assert.equal((await failedLogin()).status, 429, "The denied bucket must remain blocked on retry");
console.log("Production smoke passed: database, authentication, origin checks, protected pages, fresh-company screens, session revocation and concurrent login throttling.");
