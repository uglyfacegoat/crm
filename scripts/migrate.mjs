import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

export async function runMigrations({
  databaseUrl,
  migrationsDirectory = resolve("db/migrations"),
  onApplied = (name) => console.log(`Applied ${name}`),
}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations.");
  const filenames = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  if (!filenames.length) throw new Error("No SQL migrations found.");
  const migrations = await Promise.all(filenames.map(async (name) => {
    const source = await readFile(resolve(migrationsDirectory, name), "utf8");
    return { name, source, checksum: createHash("sha256").update(source).digest("hex") };
  }));
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10, onnotice: () => undefined });
  try {
    const connection = await sql.reserve();
    try {
      // Pin the lock to one connection for the entire history check and migration batch.
      await connection`SET lock_timeout = '60s'`;
      await connection`SELECT pg_advisory_lock(hashtext('crm_schema_migrations'))`;
      await connection`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      const applied = await connection`SELECT name, checksum FROM schema_migrations ORDER BY name`;
      for (const [index, recorded] of applied.entries()) {
        const migration = migrations[index];
        if (!migration || migration.name !== recorded.name) {
          throw new Error(`Migration history diverges at ${recorded.name}; applied files cannot be removed or reordered.`);
        }
        if (migration.checksum !== recorded.checksum) {
          throw new Error(`Applied migration ${recorded.name} has been modified.`);
        }
      }

      for (const migration of migrations.slice(applied.length)) {
        await connection`BEGIN`;
        try {
          await connection.unsafe(migration.source);
          await connection`INSERT INTO schema_migrations (name, checksum) VALUES (${migration.name}, ${migration.checksum})`;
          await connection`COMMIT`;
        } catch (error) {
          try {
            await connection`ROLLBACK`;
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], `Migration ${migration.name} and rollback failed.`);
          }
          throw error;
        }
        onApplied(migration.name);
      }
    } finally {
      // Closing the dedicated pool also releases the session lock after failures.
      connection.release();
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runMigrations({ databaseUrl: process.env.DATABASE_URL });
}
