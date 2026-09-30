import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const image = process.env.CRM_PRODUCTION_CHECK_IMAGE;
if (!image) throw new Error("Set CRM_PRODUCTION_CHECK_IMAGE to a built candidate image.");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "crm-production-stack-"));
const project = `crm-prod-check-${randomUUID().slice(0, 8)}`;
const certificate = join(directory, "certificate.pem");
const privateKey = join(directory, "private-key.pem");
const backupExport = join(directory, "backup-export");
const bootstrap = join(directory, ".env.production.bootstrap");
const databasePassword = randomBytes(32).toString("hex");
const adminPassword = randomBytes(32).toString("hex");
const adminEmail = "production-check@example.invalid";
const databaseUrl = `postgresql://crm_app:${databasePassword}@database:5432/crm`;
const dockerEnvironment = Object.fromEntries(["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "TMPDIR"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

async function run(command, args, { environment = dockerEnvironment, quiet = true } = {}) {
  const child = spawn(command, args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => { output += chunk; if (!quiet) process.stdout.write(chunk); });
  child.stderr.on("data", (chunk) => { errors += chunk; if (!quiet) process.stderr.write(chunk); });
  const code = await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
  if (code !== 0) throw new Error(`${command} ${args.slice(-2).join(" ")} failed (${code}): ${errors.slice(-1200)}`);
  return output;
}

async function freePort() {
  const server = createServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const port = server.address().port;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return port;
}

async function httpsPost(origin, ca, path, payload) {
  return new Promise((done, reject) => {
    const body = JSON.stringify(payload);
    const outgoing = request(new URL(path, origin), { ca, servername: "localhost", family: 4,
      method: "POST", timeout: 15_000, headers: { origin, "content-type": "application/json",
        "content-length": Buffer.byteLength(body) } }, (response) => {
      let responseBody = "";
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => done({ status: response.statusCode, headers: response.headers, body: responseBody }));
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.on("timeout", () => outgoing.destroy(new Error("HTTPS request timed out")));
    outgoing.end(body);
  });
}

const composeArgs = ["compose", "--env-file", join(directory, ".env.production"), "-p", project,
  "-f", join(directory, "compose.production.yaml")];
const compose = (args, options) => run("docker", [...composeArgs, ...args], options);

try {
  await mkdir(join(directory, "gateway"));
  await mkdir(backupExport, { mode: 0o700 });
  await copyFile(join(root, "compose.production.yaml"), join(directory, "compose.production.yaml"));
  await copyFile(join(root, "gateway/default.conf.template"), join(directory, "gateway/default.conf.template"));
  await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-keyout", privateKey, "-out", certificate]);
  const httpPort = await freePort();
  const httpsPort = await freePort();
  const origin = `https://localhost:${httpsPort}`;
  await writeFile(join(directory, ".env.production"), [
    `CRM_APP_IMAGE=${image}`, `CRM_PUBLIC_ORIGIN=${origin}`, "CRM_PUBLIC_HOST=localhost",
    `CRM_TLS_CERTIFICATE=${certificate}`, `CRM_TLS_PRIVATE_KEY=${privateKey}`,
    `CRM_BACKUP_EXPORT_PATH=${backupExport}`, "CRM_HTTPS_BIND_ADDRESS=127.0.0.1",
    `CRM_HTTP_PORT=${httpPort}`, `CRM_HTTPS_PORT=${httpsPort}`, "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(directory, ".env.production.database"), [
    "POSTGRES_USER=crm_app", `POSTGRES_PASSWORD=${databasePassword}`, "POSTGRES_DB=crm", "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(directory, ".env.production.web"), [
    `DATABASE_URL=${databaseUrl}`, `AUTH_THROTTLE_SECRET=${randomBytes(32).toString("hex")}`,
    "DOCUMENT_STORAGE_BACKEND=local", "DOCUMENT_STORAGE_ROOT=/app/storage", "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(directory, ".env.production.workers"), [
    `DATABASE_URL=${databaseUrl}`, "REMINDER_WORKER_INTERVAL_MS=60000", "WORKFLOW_WORKER_INTERVAL_MS=5000", "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(join(directory, ".env.production.backup"), [
    `DATABASE_URL=${databaseUrl}`, "DOCUMENT_STORAGE_BACKEND=local", "DOCUMENT_STORAGE_ROOT=/app/storage",
    "BACKUP_ROOT=/app/backups", "BACKUP_EXPORT_ROOT=/app/backup-export", "",
  ].join("\n"), { mode: 0o600 });
  await writeFile(bootstrap, ["AUTH_BOOTSTRAP_ORGANIZATION_NAME=Production check",
    "AUTH_BOOTSTRAP_TIMEZONE=Europe/Moscow", "AUTH_BOOTSTRAP_ADMIN_NAME=Test administrator",
    `AUTH_BOOTSTRAP_ADMIN_EMAIL=${adminEmail}`, `AUTH_BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}`, "",
  ].join("\n"), { mode: 0o600 });
  const configuration = JSON.parse(await compose(["config", "--format", "json"]));
  assert.equal(configuration.name, project);
  assert.equal(configuration.services.database.ports?.length ?? 0, 0);
  assert.equal(configuration.services.crm.ports?.length ?? 0, 0);
  await compose(["up", "-d", "--no-build", "--wait", "--wait-timeout", "240"], { quiet: false });
  await compose(["run", "--rm", "--no-deps", "--env-from-file", bootstrap,
    "--entrypoint", "node", "crm", "--experimental-strip-types", "scripts/create-admin.ts"]);
  const login = await httpsPost(origin, await readFile(certificate), "/api/v1/auth/login",
    { identity: adminEmail, password: adminPassword });
  assert.equal(login.status, 200, "Bootstrapped administrator must sign in through production HTTPS");
  const sessionCookies = login.headers["set-cookie"] ?? [];
  assert.ok(sessionCookies.some((cookie) => /; Secure(?:;|$)/i.test(cookie)),
    "Bootstrapped session cookie must be secure");
  console.log("Production stack passed: isolated volumes, required scanner, healthy services and bootstrapped HTTPS login.");
} finally {
  try { await compose(["down", "--volumes", "--remove-orphans"]); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
