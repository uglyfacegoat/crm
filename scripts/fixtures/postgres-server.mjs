import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";

export async function startPostgresFixture() {
  const name = `crm-postgres-test-${randomUUID()}`;
  const user = "crm_test_admin";
  const password = randomBytes(32).toString("hex");
  let created = false;
  const close = async () => {
    if (created) {
      execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
      created = false;
    }
  };
  try {
    execFileSync("docker", ["run", "--detach", "--name", name,
      "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
      "--env", "POSTGRES_USER", "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_DB",
      "postgres:17-alpine"], {
      env: { ...process.env, POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: "postgres" },
      stdio: "ignore",
    });
    created = true;
    const [container] = JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8" }));
    const port = container.NetworkSettings.Ports["5432/tcp"][0].HostPort;
    const adminUrl = new URL(`postgresql://${user}:${password}@127.0.0.1:${port}/postgres`);
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const sql = postgres(adminUrl.toString(), { max: 1, connect_timeout: 1, onnotice: () => {} });
      try {
        ready = (await sql`SELECT current_database() AS name`)[0].name === "postgres";
      } catch { /* The temporary server may still be initializing. */ }
      finally { await sql.end({ timeout: 1 }); }
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, "Isolated PostgreSQL fixture failed to become ready");
    const dockerAdminUrl = new URL(adminUrl);
    dockerAdminUrl.hostname = "host.docker.internal";
    return { adminUrl: adminUrl.toString(), dockerAdminUrl: dockerAdminUrl.toString(), close, containerName: name };
  } catch (error) { await close(); throw error; }
}
