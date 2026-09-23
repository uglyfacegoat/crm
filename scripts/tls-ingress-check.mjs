import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const project = `crm-tls-check-${randomUUID().slice(0, 8)}`;
const directory = await mkdtemp(join(tmpdir(), `${project}-`));
const certificate = join(directory, "certificate.pem");
const privateKey = join(directory, "private-key.pem");
let browser;

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return String(port);
}

const httpsPort = await freePort();
const httpPort = await freePort();
const origin = `https://localhost:${httpsPort}`;
const environment = {
  ...process.env,
  CRM_APP_IMAGE: process.env.CRM_TLS_CHECK_IMAGE ?? "crm-app:tls-check",
  CRM_DB_USER: "crm_tls_test",
  CRM_DB_NAME: "crm_tls_test",
  CRM_DB_PASSWORD: randomBytes(32).toString("hex"),
  CRM_DB_PORT: "5432", // Required by the base file, removed by the HTTPS override.
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"),
  CRM_WEBSITE_WEBHOOK_SECRET: "",
  CRM_PUBLIC_ORIGIN: origin,
  CRM_PUBLIC_HOST: "localhost",
  CRM_HTTP_PORT: httpPort,
  CRM_HTTPS_PORT: httpsPort,
  CRM_HTTPS_BIND_ADDRESS: "127.0.0.1",
  CRM_TLS_CERTIFICATE: certificate,
  CRM_TLS_PRIVATE_KEY: privateKey,
  CRM_BACKUP_EXPORT_PATH: directory,
  AUTH_BOOTSTRAP_ORGANIZATION_NAME: "TLS acceptance test",
  AUTH_BOOTSTRAP_ADMIN_NAME: "TLS test administrator",
  AUTH_BOOTSTRAP_ADMIN_EMAIL: "tls@example.invalid",
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow",
};

async function run(command, args, { quiet = false } = {}) {
  const child = spawn(command, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; if (!quiet) process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { if (!quiet) process.stderr.write(chunk); });
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} failed (exit ${code})`)));
  });
  return output;
}

const composeArgs = ["compose", "--env-file", "/dev/null", "-p", project, "-f", "scripts/fixtures/compose.tls-check.yaml"];
const compose = (args, options) => run("docker", [...composeArgs, ...args], options);

try {
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", privateKey, "-out", certificate], { quiet: true });
  const configuration = JSON.parse(await compose(["config", "--format", "json"], { quiet: true }));
  assert.equal(configuration.services.crm.ports?.length ?? 0, 0);
  assert.equal(configuration.services.database.ports?.length ?? 0, 0);
  assert.equal(configuration.services.crm.environment.AUTH_COOKIE_SECURE, "true");
  assert.equal(configuration.services.crm.environment.CRM_TRUST_PROXY, "true");
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "120", "gateway"]);
  await compose(["exec", "-T", ...Object.keys(environment).filter((key) => key.startsWith("AUTH_BOOTSTRAP_")).flatMap((key) => ["-e", key]), "crm", "node", "--experimental-strip-types", "scripts/create-admin.ts"]);

  const ca = await readFile(certificate);
  const send = (path, options = {}) => new Promise((resolve, reject) => {
    const { body, ...requestOptions } = options;
    const outgoing = request(new URL(path, origin), { ca, servername: "localhost", family: 4, timeout: 15_000, ...requestOptions }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: text }));
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.on("timeout", () => outgoing.destroy(new Error("TLS request timed out")));
    outgoing.end(body);
  });

  const redirect = await fetch(`http://127.0.0.1:${httpPort}/login?next=%2Ftasks`, { redirect: "manual" });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get("location"), `${origin}/login?next=%2Ftasks`);
  const protectedPage = await send("/tasks");
  assert.equal(protectedPage.status, 307);
  assert.equal(new URL(protectedPage.headers.location, origin).href, `${origin}/login?next=%2Ftasks`);
  for (const path of ["live", "ready", "health"]) {
    const response = await send(`/api/v1/system/${path}`);
    assert.equal(response.status, 200, `${path} must succeed with the test database available`);
    assert.equal(response.headers["cache-control"], "no-store");
    if (path !== "live") {
      assert.equal(JSON.parse(response.body).database, "available");
      assert.equal(JSON.parse(response.body).storage, "available");
    }
  }
  for (const version of ["TLSv1.2", "TLSv1.3"]) {
    const login = await send("/login", { minVersion: version, maxVersion: version });
    assert.equal(login.status, 200);
    assert.match(login.headers["strict-transport-security"], /max-age=31536000/);
    assert.match(login.headers["content-security-policy"], /nonce-/);
  }
  await assert.rejects(send("/login", { maxVersion: "TLSv1.1", minVersion: "TLSv1", ciphers: "ALL:@SECLEVEL=0" }), /protocol version|unsupported protocol|no protocols available/i);
  assert.equal((await send("/login", { headers: { host: "untrusted.invalid", "x-forwarded-host": new URL(origin).host } })).status, 421);
  assert.equal((await send("/api/v1/auth/logout", { method: "POST", headers: { origin: "https://untrusted.invalid" } })).status, 403);
  assert.equal((await send("/api/v1/auth/login", { method: "POST", headers: { origin, "content-length": String(33 * 1024) }, body: "x".repeat(33 * 1024) })).status, 413);
  assert.equal((await send("/api/v1/documents/export", { method: "POST", headers: { origin, "content-length": String(17 * 1024 * 1024), expect: "100-continue" } })).status, 413);

  const login = await send("/api/v1/auth/login", {
    method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": "203.0.113.99", "x-forwarded-for": "203.0.113.99" },
    body: JSON.stringify({ identity: environment.AUTH_BOOTSTRAP_ADMIN_EMAIL, password: environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers["set-cookie"].find((value) => value.startsWith("crm_session="));
  assert.match(cookie, /; Secure/i);
  assert.match(cookie, /; HttpOnly/i);
  assert.match(cookie, /; SameSite=lax/i);
  assert.equal((await send("/api/v1/auth/session", { headers: { cookie: cookie.split(";")[0] } })).status, 200);

  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  // Certificate verification is exercised above with the generated CA, without changing the OS trust store.
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/login?next=%2Ftasks`);
  await page.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  await page.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL(`${origin}/tasks`);
  await page.getByRole("heading", { name: "Задачи", exact: true }).waitFor();
  assert.deepEqual(errors, []);

  const redirectPage = await browser.newPage({ ignoreHTTPSErrors: true });
  await redirectPage.goto(`${origin}/login?next=${encodeURIComponent("/\\untrusted.invalid")}`);
  assert.equal(await redirectPage.locator('input[name="next"]').inputValue(), "/");
  await redirectPage.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  await redirectPage.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
  await redirectPage.locator('input[name="next"]').evaluate((input) => { input.value = "/\\untrusted.invalid"; });
  await redirectPage.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await redirectPage.waitForURL(`${origin}/`);

  const statuses = await Promise.all(Array.from({ length: 12 }, (_, index) => send("/api/v1/auth/login", {
    method: "POST", headers: { origin, "x-real-ip": `203.0.113.${index + 1}` },
  }).then((response) => response.status)));
  assert.ok(statuses.includes(429), "Changing a client-supplied IP must not bypass the gateway limit");
  assert.ok(statuses.every((status) => [415, 429].includes(status)));
  await compose(["exec", "-T", "--user", "root", "crm", "chmod", "0500", "/app/storage"]);
  try {
    const storageFailure = await send("/api/v1/system/ready");
    assert.equal(storageFailure.status, 503, "Readiness must fail when the document volume is not writable");
    assert.deepEqual(JSON.parse(storageFailure.body), { status: "unavailable", service: "crm-web", database: "available", storage: "unavailable", scanner: "disabled" });
    assert.equal((await send("/api/v1/system/live")).status, 200);
  } finally {
    await compose(["exec", "-T", "--user", "root", "crm", "chmod", "0700", "/app/storage"]);
  }
  assert.equal((await send("/api/v1/system/ready")).status, 200);
  await compose(["stop", "database"]);
  const liveWithoutDatabase = await send("/api/v1/system/live");
  assert.equal(liveWithoutDatabase.status, 200, "The packaged web process must remain live during a database outage");
  assert.equal(liveWithoutDatabase.headers["cache-control"], "no-store");
  for (const path of ["ready", "health"]) {
    const response = await send(`/api/v1/system/${path}`);
    assert.equal(response.status, 503, `${path} must fail when PostgreSQL is unavailable`);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(JSON.parse(response.body), { status: "unavailable", service: "crm-web", database: "unavailable", storage: "available", scanner: "disabled" });
    assert.doesNotMatch(response.body, new RegExp(environment.CRM_DB_PASSWORD));
  }
  const webLogs = await compose(["logs", "--no-color", "crm"], { quiet: true });
  for (const secret of [environment.CRM_DB_PASSWORD, environment.AUTH_THROTTLE_SECRET, environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD]) {
    assert.ok(!webLogs.includes(secret), "The packaged web log must not contain test credentials");
  }
  console.log("TLS ingress passed: private app/database ports, verified certificate, TLS 1.2/1.3, HTTP redirect, secure cookies, login action, host/origin rejection, body caps, rate limit and packaged live/ready behavior during a database outage.");
} finally {
  await browser?.close();
  // This randomly named project and directory belong exclusively to this test run.
  await compose(["down", "--volumes", "--remove-orphans"]);
  await rm(directory, { recursive: true });
}
