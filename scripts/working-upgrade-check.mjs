// Rehearse migrations against a private, disposable copy of the local database.
// No dump is written to disk. The fixture uses tmpfs and is removed in finally.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { startPostgresFixture } from "./fixtures/postgres-server.mjs";

const sourceContainer = "crm-database-1";
const anonymizationSalt = randomBytes(32).toString("hex");
const sourceCommand = ["exec", sourceContainer, "sh", "-c", 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'];
const targetCommand = (container) => ["exec", "-i", container, "sh", "-c", 'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges'];
const q = (value) => `"${value.replaceAll('"', '""')}"`;

async function copySnapshot(container) {
  const dump = spawn("docker", sourceCommand, { stdio: ["ignore", "pipe", "pipe"] });
  const restore = spawn("docker", targetCommand(container), { stdio: ["pipe", "ignore", "pipe"] });
  dump.stdout.pipe(restore.stdin);
  // Never print PostgreSQL stderr: it can include values from source rows.
  dump.stderr.resume();
  restore.stderr.resume();
  const finished = (child) => new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Snapshot copy process failed")));
  });
  await Promise.all([finished(dump), finished(restore)]);
}

const safeColumns = new Set([
  "schema_migrations.name", "schema_migrations.checksum",
  "background_job_status.job_name",
  "masters.working_days",
  "chat_channel_avatars.mime_type", "chat_message_attachments.mime_type", "chat_message_attachments.extension",
  "document_template_versions.mime_type", "document_template_versions.extension",
  "document_versions.mime_type", "document_versions.extension",
  "organizations.timezone", "orders.currency", "order_invoices.currency",
  "member_login_identities.kind", "member_permission_overrides.permission",
  "organization_members.role", "chat_channel_members.channel_role",
  "chat_channels.kind", "chat_channels.audience_kind", "clients.kind",
  "organizations.organization_kind", "organization_units.unit_kind",
  "contract_relations.relation_type", "contract_schedule_rules.frequency_unit",
  "service_visit_series.frequency_unit", "document_templates.template_kind",
  "chat_messages.message_kind", "chat_messages.system_event_key",
  "chat_message_entities.entity_type", "audit_events.entity_type", "audit_events.action",
  "contract_events.event_type", "service_visit_events.event_type", "task_events.event_type",
  "notifications.kind", "notifications.severity", "notifications.source_type", "notifications.target_type",
  "tasks.status", "tasks.priority", "tasks.source", "tasks.reminder_kind",
  "orders.status", "service_visits.status", "contracts.status", "support_requests.status",
  "order_invoices.status", "order_payments.status", "order_master_payouts.status",
  "order_payments.payment_method", "order_master_payouts.payment_method",
  "website_leads.moderation_status", "websites.status", "website_integrations.status",
  "website_sync_runs.status", "website_health_snapshots.health_status", "backup_runs.status",
  "background_job_status.status", "masters.operational_status", "idempotency_requests.operation",
  "request_rate_limits.operation", "order_expenses.category", "documents.category",
  "support_requests.category", "website_daily_metrics.provider", "website_health_snapshots.source",
  "website_integrations.provider", "website_sync_runs.provider", "website_hosting_profiles.provider",
  "masters.service_zone", "chat_message_reactions.emoji",
]);

function replacement(table, column, type) {
  const key = `${table}.${column}`;
  if (safeColumns.has(key)) return null;
  if (type === "jsonb") return "'{}'::jsonb";
  if (type === "ARRAY") return "ARRAY[]::text[]";
  if (column === "skills") return "ARRAY[]::text[]";
  if (column === "email" || column.endsWith("_email") || column === "handled_by_email") {
    return `('anon-' || md5(t.${q(column)} || '${anonymizationSalt}') || '@example.invalid')`;
  }
  if (column === "normalized_value" && table === "member_login_identities") {
    return `CASE WHEN t.kind = 'email' THEN 'anon-' || md5(t.normalized_value || '${anonymizationSalt}') || '@example.invalid' ELSE '+79' || lpad(n.rn::text, 9, '0') END`;
  }
  if (column.includes("phone")) return "'+79' || lpad(n.rn::text, 9, '0')";
  if (column === "domain") return "'anon-' || n.rn::text || '.invalid'";
  if (column === "archive_name") return "'20260923T000000Z-' || left(md5(n.rn::text), 8)";
  if (column.endsWith("_url")) return "'https://example.invalid/' || n.rn::text";
  if (column === "storage_key") return "'anonymized/' || md5(n.rn::text || '" + table + "')";
  if (column.endsWith("sha256") || column.endsWith("_hash") || column === "payload_fingerprint") {
    return "md5(n.rn::text || '" + table + "') || md5('second-' || n.rn::text || '" + table + "')";
  }
  if (column === "password_hash") return "'disabled-anonymized-' || n.rn::text";
  if (column === "original_filename") return "'anonymized-' || n.rn::text || '.bin'";
  if (column === "normalized_phone") return "'+79' || lpad(n.rn::text, 9, '0')";
  if (column === "tax_id") return "lpad(n.rn::text, 10, '0')";
  if (column === "token_hash" || column === "bucket_hash") return "md5(n.rn::text || '" + table + "') || md5('second-' || n.rn::text)";
  if (type === "character") return "'ANON'";
  return "'Anonymized ' || n.rn::text";
}

async function tableCounts(sql) {
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const counts = new Map();
  for (const { tablename } of tables) {
    counts.set(tablename, Number((await sql.unsafe(`SELECT count(*)::integer AS count FROM ${q(tablename)}`))[0].count));
  }
  return counts;
}

async function anonymize(sql) {
  const columns = await sql`SELECT table_name, column_name, data_type
    FROM information_schema.columns WHERE table_schema = 'public'
    AND data_type IN ('text', 'character', 'jsonb', 'ARRAY')
    ORDER BY table_name, ordinal_position`;
  const byTable = new Map();
  const fingerprints = [];
  for (const column of columns) {
    const update = replacement(column.table_name, column.column_name, column.data_type);
    if (!update) continue;
    const assignments = byTable.get(column.table_name) ?? [];
    assignments.push(`${q(column.column_name)} = CASE WHEN t.${q(column.column_name)} IS NULL THEN NULL ELSE ${update} END`);
    byTable.set(column.table_name, assignments);
    fingerprints.push({ table: column.table_name, column: column.column_name });
  }
  const fingerprint = async ({ table, column }) => (await sql.unsafe(
    `SELECT count(${q(column)})::integer AS populated,
      md5(coalesce(string_agg(${q(column)}::text, '|' ORDER BY ${q(column)}::text), '')) AS digest
      FROM ${q(table)}`))[0];
  const before = await Promise.all(fingerprints.map(fingerprint));
  for (const [table, assignments] of byTable) {
    const statement = `WITH numbered AS (SELECT ctid, row_number() OVER (ORDER BY ctid) AS rn FROM ${q(table)})
      UPDATE ${q(table)} AS t SET ${assignments.join(", ")} FROM numbered AS n WHERE t.ctid = n.ctid`;
    try { await sql.unsafe(statement); }
    catch (error) { error.safeTable = table; throw error; }
  }
  const after = await Promise.all(fingerprints.map(fingerprint));
  for (const [index, entry] of fingerprints.entries()) {
    assert.equal(after[index].populated, before[index].populated, `Null count changed in ${entry.table}.${entry.column}`);
    if (before[index].populated > 0) {
      assert.notEqual(after[index].digest, before[index].digest, `Unchanged sensitive column ${entry.table}.${entry.column}`);
    }
  }
  return { maskedColumns: fingerprints.length,
    populatedMaskedColumns: before.filter((item) => item.populated > 0).length };
}

const fixture = await startPostgresFixture();
let sql;
let stage = "copy";
try {
  await copySnapshot(fixture.containerName);
  sql = postgres(fixture.adminUrl, { max: 1, onnotice: () => {} });
  stage = "baseline";
  const beforeCounts = await tableCounts(sql);
  const beforeHistory = await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`;
  assert.equal(beforeHistory.length, 55, "Expected the current 55-migration working schema");
  stage = "anonymize";
  const { maskedColumns, populatedMaskedColumns } = await anonymize(sql);
  stage = "mask-counts";
  assert.deepEqual(await tableCounts(sql), beforeCounts, "Anonymization changed row counts");
  stage = "migrate";
  await runMigrations({ databaseUrl: fixture.adminUrl, onApplied: () => {} });
  stage = "history";
  const afterHistory = await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`;
  stage = "historic-checksums";
  for (let index = 0; index < beforeHistory.length; index += 1) {
    const before = beforeHistory[index];
    const after = afterHistory[index];
    if (before.name !== after?.name || before.checksum !== after?.checksum ||
        before.applied_at.getTime() !== after?.applied_at.getTime()) {
      const error = new Error("History mismatch");
      error.historyIndex = index;
      error.historyFields = ["name", "checksum", "applied_at"].filter((field) =>
        String(before[field]) !== String(after?.[field]));
      throw error;
    }
  }
  const filenames = (await readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
  stage = "migration-count";
  assert.equal(afterHistory.length, filenames.length, "Not all migrations were applied");
  stage = "row-counts";
  const afterCounts = await tableCounts(sql);
  for (const [table, before] of beforeCounts) {
    if (table !== "schema_migrations") assert.equal(afterCounts.get(table), before, `Row count changed in ${table}`);
  }
  stage = "idempotency";
  await runMigrations({ databaseUrl: fixture.adminUrl, onApplied: () => assert.fail("Retry applied a migration") });
  assert.deepEqual(await sql`SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name`, afterHistory);
  console.log(JSON.stringify({ status: "passed", oldMigrations: beforeHistory.length,
    newMigrations: afterHistory.length, preservedTables: beforeCounts.size - 1,
    maskedColumns, populatedMaskedColumns }));
} catch (error) {
  const safeIdentifier = (value) => typeof value === "string" && /^[a-z][a-z0-9_]{0,90}$/.test(value) ? value : undefined;
  console.error(JSON.stringify({ status: "failed", code: error.code ?? "UPGRADE_CHECK_FAILED",
    stage, table: safeIdentifier(error.safeTable ?? error.table_name), constraint: safeIdentifier(error.constraint_name),
    historyIndex: error.historyIndex, historyFields: error.historyFields }));
  process.exitCode = 1;
} finally {
  if (sql) await sql.end();
  await fixture.close();
}
