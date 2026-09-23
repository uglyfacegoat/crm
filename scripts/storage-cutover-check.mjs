import { spawn } from "node:child_process";
import { once } from "node:events";

for (const name of [
  "MIGRATION_TEST_ADMIN_URL", "STORAGE_CUTOVER_TEST_DOCKER_ADMIN_URL",
  "STORAGE_CUTOVER_TEST_RUNTIME", "STORAGE_CUTOVER_TEST_IMAGE",
]) {
  if (!process.env[name]) throw new Error(`Set ${name} for the disposable storage cutover rehearsal.`);
}

const child = spawn(process.execPath, ["--test", "scripts/storage-transfer.integration.mjs"], {
  env: process.env, stdio: "inherit",
});
const [code] = await once(child, "exit");
if (code !== 0) throw new Error("Storage cutover rehearsal failed.");
