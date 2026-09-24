import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

const image = process.env.BACKUP_FULL_STAGE_TEST_IMAGE;
if (!image) throw new Error("Set BACKUP_FULL_STAGE_TEST_IMAGE to the packaged candidate image.");

const database = await startPostgresFixture();
try {
  const child = spawn("docker", [
    "run", "--rm", "--add-host", "host.docker.internal:host-gateway",
    "--tmpfs", "/fs11-stage:rw,size=1m,mode=0700,uid=1001,gid=1001",
    "--env", "BACKUP_TEST_ADMIN_URL", "--env", "BACKUP_TEST_FULL_STAGE_ROOT=/fs11-stage",
    "--mount", `type=bind,source=${resolve("scripts/backup-restore.integration.mjs")},target=/app/scripts/backup-restore.integration.mjs,readonly`,
    "--entrypoint", "node", image, "--test", "scripts/backup-restore.integration.mjs",
  ], { env: { ...process.env, BACKUP_TEST_ADMIN_URL: database.dockerAdminUrl }, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Packaged full-staging-volume backup acceptance failed.");
} finally { await database.close(); }
