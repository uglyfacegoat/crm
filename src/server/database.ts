import "server-only";
import postgres from "postgres";
import { z } from "zod";

const databaseUrlSchema = z.string().url().refine(
  (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
  "DATABASE_URL must use the PostgreSQL protocol",
);

let database: ReturnType<typeof postgres> | undefined;

export function getDatabase() {
  if (database) return database;

  const databaseUrl = databaseUrlSchema.parse(process.env.DATABASE_URL);
  database = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: true,
  });

  return database;
}
