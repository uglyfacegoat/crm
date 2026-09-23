import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

const image = process.env.BACKUP_RESTORE_TEST_IMAGE;
const hostToolsAvailable = ["pg_dump", "pg_restore", "tar"].every(command =>
  spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0);
if (!image && !hostToolsAvailable) {
  throw new Error("Set BACKUP_RESTORE_TEST_IMAGE to a built CRM image or install PostgreSQL client tools and tar.");
}

const fixture = await startPostgresFixture();
try {
  const environment = { ...process.env,
    DATABASE_URL: fixture.adminUrl, BACKUP_TEST_ADMIN_URL: fixture.adminUrl,
    BACKUP_TEST_S3: "false", BACKUP_TEST_FULL_STAGE_ROOT: "",
  };
  const child = image
    ? spawn("docker", ["run", "--rm", "--add-host", "host.docker.internal:host-gateway",
      "--env", "BACKUP_TEST_ADMIN_URL", "--env", "BACKUP_TEST_S3",
      "--mount", `type=bind,source=${resolve("scripts/backup-restore.integration.mjs")},target=/app/scripts/backup-restore.integration.mjs,readonly`,
      "--entrypoint", "node", image, "--test", "scripts/backup-restore.integration.mjs"],
    { env: { ...environment, BACKUP_TEST_ADMIN_URL: fixture.dockerAdminUrl }, stdio: "inherit" })
    : spawn(process.execPath, ["--test", "scripts/backup-restore.integration.mjs"],
      { env: environment, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Isolated backup/restore integration failed.");
} finally { await fixture.close(); }
