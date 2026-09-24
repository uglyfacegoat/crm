import { spawn } from "node:child_process";
import { once } from "node:events";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

const fixture = await startPostgresFixture();
try {
  const child = spawn(process.execPath, ["--test", "scripts/storage-transfer.integration.mjs"], {
    env: { ...process.env, MIGRATION_TEST_ADMIN_URL: fixture.adminUrl,
      STORAGE_CUTOVER_TEST_RUNTIME: "", STORAGE_CUTOVER_TEST_IMAGE: "" },
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Storage transfer integration failed.");
} finally { await fixture.close(); }
