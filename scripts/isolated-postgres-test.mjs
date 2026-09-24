import { spawn } from "node:child_process";
import { once } from "node:events";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

const args = process.argv.slice(2);
if (!args.length) throw new Error("Pass the Node test script and options.");

const fixture = await startPostgresFixture();
try {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, DATABASE_URL: fixture.adminUrl,
      MIGRATION_TEST_ADMIN_URL: fixture.adminUrl, BACKUP_TEST_ADMIN_URL: fixture.adminUrl },
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  if (code !== 0) throw new Error("Isolated PostgreSQL test failed.");
} finally { await fixture.close(); }
