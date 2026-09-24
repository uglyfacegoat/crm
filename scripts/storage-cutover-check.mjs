import { spawn } from "node:child_process";
import { once } from "node:events";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

for (const name of [
  "STORAGE_CUTOVER_TEST_RUNTIME", "STORAGE_CUTOVER_TEST_IMAGE", "CHROME_PATH",
]) {
  if (!process.env[name]) throw new Error(`Set ${name} for the disposable storage cutover rehearsal.`);
}

const fixture = await startPostgresFixture();
try {
  const child = spawn(process.execPath, ["--test", "scripts/storage-transfer.integration.mjs"], {
    env: { ...process.env, MIGRATION_TEST_ADMIN_URL: fixture.adminUrl,
      STORAGE_CUTOVER_TEST_DOCKER_ADMIN_URL: fixture.dockerAdminUrl },
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Storage cutover rehearsal failed.");
} finally { await fixture.close(); }
