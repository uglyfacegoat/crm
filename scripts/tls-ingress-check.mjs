import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { pdfFixture } from "./fixtures/pdf.mjs";

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
  const bodyTempMount = (await compose(["exec", "-T", "gateway", "stat", "-f", "-c", "%T %b %S",
    "/var/cache/nginx/client_temp"], { quiet: true })).trim().split(" ");
  assert.equal(bodyTempMount[0], "tmpfs", "Gateway body spill must not use the container overlay");
  assert.equal(Number(bodyTempMount[1]) * Number(bodyTempMount[2]), 80 * 1024 * 1024,
    "Gateway body spill must have its 80 MiB mount limit");
  await compose(["exec", "-T", "--user", "101", "gateway", "sh", "-c",
    "test -w /var/cache/nginx/client_temp"], { quiet: true });
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
  async function holdMultipartUploads(bytesPerRequest = 128 * 1024) {
    const uploads = [];
    try {
      for (let index = 0; index < 4; index += 1) {
        const upload = request(new URL("/documents", origin), {
          ca, servername: "localhost", family: 4, method: "POST", timeout: 10_000,
          headers: { origin, "content-type": "multipart/form-data; boundary=crm-ingress-check",
            "content-length": String(15 * 1024 * 1024), "next-action": "invalid-ingress-check" },
        });
        upload.on("error", () => {});
        upload.on("response", (response) => response.resume());
        uploads.push(upload);
        let sent = 0;
        while (sent < bytesPerRequest) {
          const chunk = Buffer.alloc(Math.min(256 * 1024, bytesPerRequest - sent), 0x58);
          await new Promise((resolveWritten, rejectWritten) => upload.write(chunk,
            (error) => error ? rejectWritten(error) : resolveWritten()));
          sent += chunk.length;
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      return uploads;
    } catch (error) {
      for (const upload of uploads) upload.destroy();
      throw error;
    }
  }

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

  const heldUploads = await holdMultipartUploads(14 * 1024 * 1024);
  try {
    const [blocks, freeBlocks, blockSize] = (await compose(["exec", "-T", "gateway", "stat", "-f", "-c",
      "%b %f %S", "/var/cache/nginx/client_temp"], { quiet: true })).trim().split(" ").map(Number);
    assert.ok((blocks - freeBlocks) * blockSize >= 48 * 1024 * 1024,
      "Four held upload bodies must occupy the bounded gateway tmpfs");
    const rejected = await send("/documents", { method: "POST", headers: { origin,
      "content-type": "multipart/form-data; boundary=crm-ingress-check", "next-action": "invalid-ingress-check" },
      body: "--crm-ingress-check--\r\n" });
    assert.equal(rejected.status, 429, "Fifth concurrent multipart body must be rejected before Next");
    assert.equal((await send("/api/v1/documents/export", { method: "POST",
      headers: { origin, "content-type": "application/json" }, body: "{}" })).status, 429,
    "A JSON body must share the same four gateway permits");
    assert.equal((await send("/api/v1/system/live", { method: "GET",
      headers: { "content-length": "1" }, body: "x" })).status, 429,
    "A GET with an explicit body must not bypass gateway permits");
    assert.equal((await send("/api/v1/system/live")).status, 200, "Read-only health traffic must stay available during upload saturation");
    const gatewayLogs = await compose(["logs", "--no-color", "gateway"], { quiet: true });
    assert.ok((gatewayLogs.match(/client request body is buffered to a temporary file/g) ?? []).length >= 4,
      "Four multipart bodies must spill to gateway temporary files");
  } finally {
    for (const upload of heldUploads) upload.destroy();
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  const reopened = await send("/documents", { method: "POST", headers: { origin,
    "content-type": "multipart/form-data; boundary=crm-ingress-check", "next-action": "invalid-ingress-check" },
    body: "--crm-ingress-check--\r\n" });
  assert.notEqual(reopened.status, 429, "Multipart capacity must recover after clients disconnect");
  let occupiedBytes = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const [blocks, freeBlocks, blockSize] = (await compose(["exec", "-T", "gateway", "stat", "-f", "-c",
      "%b %f %S", "/var/cache/nginx/client_temp"], { quiet: true })).trim().split(" ").map(Number);
    occupiedBytes = (blocks - freeBlocks) * blockSize;
    if (occupiedBytes < 1024 * 1024) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  assert.ok(occupiedBytes < 1024 * 1024, "Gateway body spill must be released after clients disconnect");

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

  await compose(["exec", "-T", "database", "psql", "-U", environment.CRM_DB_USER, "-d", environment.CRM_DB_NAME,
    "-v", "ON_ERROR_STOP=1", "-c", `
      WITH member AS (SELECT organization_id FROM organization_members WHERE email = 'tls@example.invalid'),
      client AS (INSERT INTO clients (organization_id, legal_name)
        SELECT organization_id, 'Ingress client' FROM member RETURNING id, organization_id),
      obj AS (INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
        SELECT organization_id, id, 'Ingress object', 'Office', 'Test address' FROM client RETURNING id, organization_id),
      master AS (INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
        SELECT organization_id, 'Ingress master', '+70000000001', '+70000000001', 'Test region', 'Test zone'
        FROM member RETURNING id)
      INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
        client_name_snapshot, object_name_snapshot, object_address_snapshot, assigned_master_id,
        master_name_snapshot, agreed_total_minor, master_payment_snapshot_minor)
      SELECT member.organization_id, client.id, obj.id, 'INGRESS-1', 'new', 'RUB',
        'Ingress client', 'Ingress object', 'Test address', master.id, 'Ingress master', 100000, 100000
      FROM member, client, obj, master`], { quiet: true });
  await page.goto(`${origin}/documents`);
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const uploadDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await uploadDialog.locator('summary[aria-label="Заказ"]').click();
  await uploadDialog.getByRole("button", { name: /INGRESS-1/ }).click();
  await uploadDialog.locator('input[name="title"]').fill("Повтор после ограничения шлюза");
  await uploadDialog.locator('input[name="file"]').setInputFiles({
    name: "ingress-retry.pdf", mimeType: "application/pdf", buffer: pdfFixture("ingress retry"),
  });
  const retryKey = await uploadDialog.locator('input[name="idempotencyKey"]').inputValue();
  const uiHeldUploads = await holdMultipartUploads();
  try {
    await uploadDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await uploadDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера" }).waitFor({ timeout: 10_000 });
    assert.equal(await uploadDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "ingress-retry.pdf");
    assert.equal(await uploadDialog.locator('input[name="title"]').inputValue(), "Повтор после ограничения шлюза");
    assert.equal(await uploadDialog.locator('input[name="idempotencyKey"]').inputValue(), retryKey);
    const beforeRetry = await compose(["exec", "-T", "database", "psql", "-U", environment.CRM_DB_USER,
      "-d", environment.CRM_DB_NAME, "-t", "-A", "-c",
      "SELECT count(*) FROM documents WHERE title = 'Повтор после ограничения шлюза'"], { quiet: true });
    assert.equal(beforeRetry.trim(), "0");
  } finally {
    for (const upload of uiHeldUploads) upload.destroy();
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  await uploadDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await uploadDialog.waitFor({ state: "hidden", timeout: 15_000 });
  const afterRetry = await compose(["exec", "-T", "database", "psql", "-U", environment.CRM_DB_USER,
    "-d", environment.CRM_DB_NAME, "-t", "-A", "-c",
    "SELECT count(*) FROM documents WHERE title = 'Повтор после ограничения шлюза'"], { quiet: true });
  assert.equal(afterRetry.trim(), "1");
  console.log("Ingress overload: document form retained file, fields and retry key; one retry saved one document.");

  const boundaryBytes = pdfFixture("gateway 15 MiB boundary", 15 * 1024 * 1024);
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const boundaryDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await boundaryDialog.locator('summary[aria-label="Заказ"]').click();
  await boundaryDialog.getByRole("button", { name: /INGRESS-1/ }).click();
  await boundaryDialog.locator('input[name="title"]').fill("PDF через шлюз 15 МиБ");
  await boundaryDialog.locator('input[name="file"]').setInputFiles({
    name: "gateway-boundary.pdf", mimeType: "application/pdf", buffer: boundaryBytes,
  });
  await boundaryDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await boundaryDialog.waitFor({ state: "hidden", timeout: 30_000 });
  const boundaryRecord = await compose(["exec", "-T", "database", "psql", "-U", environment.CRM_DB_USER,
    "-d", environment.CRM_DB_NAME, "-t", "-A", "-F", "|", "-c",
    `SELECT d.id, dv.size_bytes, dv.sha256 FROM document_versions dv JOIN documents d ON d.id = dv.document_id
      WHERE d.title = 'PDF через шлюз 15 МиБ' ORDER BY dv.version_number DESC LIMIT 1`], { quiet: true });
  const [boundaryId, boundarySize, boundaryHash] = boundaryRecord.trim().split("|");
  assert.equal(`${boundarySize}|${boundaryHash}`, `${boundaryBytes.length}|${createHash("sha256").update(boundaryBytes).digest("hex")}`);
  const cookieHeader = (await page.context().cookies(origin)).map(({ name, value }) => `${name}=${value}`).join("; ");
  const downloaded = await new Promise((resolve, reject) => {
    const outgoing = request(new URL(`/api/v1/documents/${boundaryId}/download`, origin), {
      ca, servername: "localhost", family: 4, timeout: 30_000, headers: { cookie: cookieHeader },
    }, (response) => {
      const digest = createHash("sha256");
      let size = 0;
      let paused = false;
      response.on("data", (chunk) => {
        digest.update(chunk);
        size += chunk.length;
        if (!paused) {
          paused = true;
          response.pause();
          setTimeout(() => response.resume(), 500);
        }
      });
      response.on("end", () => resolve({ status: response.statusCode, size, hash: digest.digest("hex"), paused }));
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.on("timeout", () => outgoing.destroy(new Error("TLS download timed out")));
    outgoing.end();
  });
  assert.deepEqual(downloaded, { status: 200, size: boundaryBytes.length,
    hash: createHash("sha256").update(boundaryBytes).digest("hex"), paused: true });
  const downloadLogs = await compose(["logs", "--no-color", "gateway"], { quiet: true });
  assert.doesNotMatch(downloadLogs, /upstream response is buffered to a temporary file/,
    "Gateway must not spool document responses into its overlay");
  console.log("Ingress boundary: verified 15 MiB PDF and SHA-256 passed HTTPS gateway unchanged.");

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
