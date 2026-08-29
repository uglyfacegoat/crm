import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const migrationsDirectory = resolve("db/migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  for (const migrationFile of migrationFiles) {
    const migrationSql = await readFile(resolve(migrationsDirectory, migrationFile), "utf8");
    const checksum = createHash("sha256").update(migrationSql).digest("hex");
    const [appliedMigration] = await sql`SELECT checksum FROM schema_migrations WHERE name = ${migrationFile}`;

    if (appliedMigration) {
      if (appliedMigration.checksum !== checksum) {
        throw new Error(`Applied migration ${migrationFile} has been modified.`);
      }
      continue;
    }

    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtext('crm_schema_migrations'))`;
      await transaction.unsafe(migrationSql);
      await transaction`INSERT INTO schema_migrations (name, checksum) VALUES (${migrationFile}, ${checksum})`;
    });

    console.log(`Applied ${migrationFile}`);
  }
} finally {
  await sql.end();
}
