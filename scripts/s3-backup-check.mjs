import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { startS3Fixture } from "./fixtures/s3-server.mjs";

const image = process.env.S3_BACKUP_TEST_IMAGE;
if (!image || !process.env.BACKUP_TEST_ADMIN_URL) throw new Error("Set S3_BACKUP_TEST_IMAGE and BACKUP_TEST_ADMIN_URL to the isolated PostgreSQL address reachable from Docker.");
const fixture = await startS3Fixture();
try {
  const environment = {
    ...process.env, ...fixture.environment, DOCUMENT_S3_ENDPOINT: "http://127.0.0.1:9000", BACKUP_TEST_S3: "true",
  };
  const keys = [...Object.keys(fixture.environment), "BACKUP_TEST_ADMIN_URL", "BACKUP_TEST_S3"];
  const child = spawn("docker", [
    "run", "--rm", "--network", `container:${fixture.containerName}`,
    "--mount", `type=bind,source=${resolve("scripts/backup-restore.integration.mjs")},target=/app/scripts/backup-restore.integration.mjs,readonly`,
    ...keys.flatMap(key => ["--env", key]), "--entrypoint", "node", image, "--test", "scripts/backup-restore.integration.mjs",
  ], { env: environment, stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Packaged S3 backup/restore acceptance failed.");
} finally { await fixture.close(); }
