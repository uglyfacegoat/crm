import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(join(tmpdir(), "crm-production-compose-"));
try {
  await copyFile(join(root, "compose.production.yaml"), join(directory, "compose.production.yaml"));
  await copyFile(join(root, ".env.production.example"), join(directory, ".env.production.example"));
  for (const role of ["database", "web", "workers", "backup"]) {
    await copyFile(join(root, `.env.production.${role}.example`), join(directory, `.env.production.${role}`));
  }
  await mkdir(join(directory, "gateway"));
  await copyFile(join(root, "gateway/default.conf.template"), join(directory, "gateway/default.conf.template"));
  const result = spawnSync("docker", ["compose", "--env-file", join(directory, ".env.production.example"),
    "-f", join(directory, "compose.production.yaml"), "config", "--format", "json"],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("Production Compose template failed to resolve.");
  const model = JSON.parse(result.stdout);
  assert.equal(model.name, "crm-production");
  assert.deepEqual(Object.keys(model.services).sort(), ["backup-worker", "clamav", "crm", "database",
    "gateway", "reminder-worker"]);
  for (const name of ["crm", "reminder-worker", "backup-worker"]) {
    assert.equal(model.services[name].image, "crm-app:release-candidate");
    assert.equal(model.services[name].ports?.length ?? 0, 0, `${name} must not publish a port`);
  }
  for (const name of ["database", "clamav"]) {
    assert.equal(model.services[name].ports?.length ?? 0, 0, `${name} must not publish a port`);
  }
  assert.deepEqual(model.services.gateway.ports.map(({ target }) => target).sort((a, b) => a - b), [80, 443]);
  assert.equal(model.services.crm.environment.AUTH_MODE, "required");
  assert.equal(model.services.crm.environment.AUTH_COOKIE_SECURE, "true");
  assert.equal(model.services.crm.environment.CRM_TRUST_PROXY, "true");
  assert.equal(model.services.crm.environment.CRM_FILE_SCAN_MODE, "required");
  assert.equal(model.services.crm.environment.CRM_ALLOWED_ORIGINS, "https://crm.example.com");
  assert.deepEqual(Object.keys(model.services.database.environment).sort(),
    ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"]);
  for (const name of ["reminder-worker", "backup-worker", "database"]) {
    assert.equal(model.services[name].environment.AUTH_THROTTLE_SECRET, undefined,
      `${name} must not receive the web authentication secret`);
  }
  assert.equal(model.services["backup-worker"].environment.BACKUP_EXPORT_ROOT, "/app/backup-export");
  assert.equal(model.services.gateway.tmpfs[0], "/var/cache/nginx/client_temp:size=80m,uid=101,gid=101,mode=0700");
  for (const [name, value] of Object.entries(model.volumes)) {
    assert.equal(value.external ?? false, false, `${name} must be project-owned`);
    assert.equal(value.name, `crm-production_${name}`);
  }
  assert.equal(model.networks.crm_default.external ?? false, false);
  assert.equal(model.networks.crm_default.name, "crm-production_crm_default");
  const exportMount = model.services["backup-worker"].volumes.find(({ target }) => target === "/app/backup-export");
  assert.equal(exportMount.type, "bind");
  assert.equal(exportMount.source, "/absolute/private/backup-export");
  console.log("Production Compose isolation passed: separate project, volumes, env roles, scanner and gateway-only ports.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
