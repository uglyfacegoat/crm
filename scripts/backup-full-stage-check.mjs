import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

const image = process.env.BACKUP_FULL_STAGE_TEST_IMAGE;
const network = process.env.BACKUP_FULL_STAGE_TEST_NETWORK;
if (!image || !network || !process.env.BACKUP_TEST_ADMIN_URL) {
  throw new Error("Set BACKUP_FULL_STAGE_TEST_IMAGE, BACKUP_FULL_STAGE_TEST_NETWORK and BACKUP_TEST_ADMIN_URL for an isolated PostgreSQL test.");
}

const child = spawn("docker", [
  "run", "--rm", "--network", network,
  "--tmpfs", "/fs11-stage:rw,size=1m,mode=0700,uid=1001,gid=1001",
  "--env", "BACKUP_TEST_ADMIN_URL", "--env", "BACKUP_TEST_FULL_STAGE_ROOT=/fs11-stage",
  "--mount", `type=bind,source=${resolve("scripts/backup-restore.integration.mjs")},target=/app/scripts/backup-restore.integration.mjs,readonly`,
  "--entrypoint", "node", image, "--test", "scripts/backup-restore.integration.mjs",
], { env: process.env, stdio: "inherit" });
const [code] = await once(child, "exit");
if (code !== 0) throw new Error("Packaged full-staging-volume backup acceptance failed.");
