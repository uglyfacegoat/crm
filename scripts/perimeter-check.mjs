import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL;
if (!baseUrl) throw new Error("SMOKE_BASE_URL is required.");
const origin = new URL(baseUrl).origin;
const send = (path, options = {}) => fetch(new URL(path, origin), { ...options, redirect: "manual", signal: AbortSignal.timeout(15_000) });

for (const path of ["/login", "/api/v1/auth/session", "/api/v1/system/health", "/api/v1/system/live", "/api/v1/system/ready"]) {
  const response = await send(path);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("permissions-policy"), /microphone=\(self\)/);
  assert.equal(response.headers.get("x-powered-by"), null);
}

// Every upload is a Server Action on one of these pages; the proxy must reject
// unsafe cross-origin requests before Next parses a multipart body or runs an action.
const uploadActionPages = ["/documents", "/calendar", "/finance", "/chat", "/settings"];
for (const path of ["/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/notifications/read-all", "/api/v1/documents/export", "/login", "/sites", ...uploadActionPages]) {
  for (const headers of [
    {},
    { origin: "null" },
    { origin: "https://untrusted.invalid" },
    { origin: "https://untrusted.invalid", "x-forwarded-host": "untrusted.invalid", "x-forwarded-proto": "https" },
  ]) {
    const response = await send(path, { method: "POST", headers: { ...headers, "next-action": "invalid-action-for-csrf-check" } });
    assert.equal(response.status, 403, `${path} must reject missing/foreign origins before mutation`);
    assert.equal((await response.json()).error.code, "invalid_origin");
  }
}

// Node fetch replaces a supplied Host, so use the HTTP client to exercise a forged one.
async function forgedHostStatus(path) {
  return new Promise((resolve, reject) => {
    const request = (origin.startsWith("https:") ? httpsRequest : httpRequest)(new URL(path, origin), {
      headers: { host: "untrusted.invalid", "x-forwarded-host": new URL(origin).host },
      timeout: 15_000,
    }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("Forged-host check timed out")));
    request.end();
  });
}
for (const path of ["/login", ...uploadActionPages, "/api/v1/webhooks/website-leads"]) {
  assert.equal(await forgedHostStatus(path), 421, `${path}: Forwarded Host must not admit an unconfigured public host`);
}
const webhook = await send("/api/v1/webhooks/website-leads", { method: "POST" });
assert.ok([401, 503].includes(webhook.status), "Bearer-authenticated integrations must not require browser Origin");

const nonces = [];
for (let index = 0; index < 2; index += 1) {
  const response = await send("/login");
  assert.equal(response.status, 200);
  const policy = response.headers.get("content-security-policy");
  const scriptPolicy = policy?.split(";").find((directive) => directive.trim().startsWith("script-src "));
  assert.ok(scriptPolicy);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline|unsafe-eval/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'none'/);
  const nonce = scriptPolicy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.ok((await response.text()).includes(`nonce="${nonce}"`));
  nonces.push(nonce);
}
assert.notEqual(nonces[0], nonces[1], "CSP nonces must be fresh for each response");

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(event.violatedDirective));
  });
  // Inject into parsed HTML, not through DevTools evaluation, which has privileged execution semantics.
  await page.route(`${origin}/login`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    assert.ok(html.includes("</head>"));
    await route.fulfill({
      response,
      body: html.replace("</head>", "<script>window.untrustedScriptExecuted = true</script></head>"),
    });
  });
  await page.goto(`${origin}/login`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).waitFor();
  await page.waitForFunction(() => window.cspViolations.some((directive) => directive.startsWith("script-src")));
  assert.equal(await page.evaluate(() => window.untrustedScriptExecuted), undefined, "A script without the nonce must not execute");
  assert.equal(await page.evaluate(() => document.featurePolicy.allowsFeature("microphone")), true, "Voice recording must remain permitted on the same origin");
} finally {
  await browser.close();
}
console.log("Perimeter checks passed: headers, explicit hosts/origins, forged forwarding headers, API/actions CSRF and enforced nonce CSP.");
