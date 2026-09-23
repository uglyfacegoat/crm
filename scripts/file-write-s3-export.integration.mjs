import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { exportS3Versions } from "./file-write-s3-export.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("S3 version export preserves every object version and delete marker without mutating the bucket", { timeout: 30_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_s3_export_test_${randomUUID().replaceAll("-", "")}`;
  const exportRoot = await mkdtemp(join(tmpdir(), "crm-s3-export-"));
  const fixture = await startS3Fixture();
  const objectStorage = createS3AuditStorage(fixture.environment);
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); objectStorage.close(); await fixture.close();
      await rm(exportRoot, { recursive: true, force: true }); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  const operationId = randomUUID();
  const storageKey = `${randomUUID()}/${randomUUID()}/v1.pdf`;
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${operationId}, ${[storageKey]})`;
  await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket,
    VersioningConfiguration: { Status: "Enabled" } }));
  const first = Buffer.from("%PDF-1.4\nFirst historical S3 version\n");
  const second = Buffer.from("%PDF-1.4\nSecond historical S3 version\n");
  await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: storageKey, Body: first }));
  await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: storageKey, Body: second }));
  await fixture.client.send(new DeleteObjectCommand({ Bucket: fixture.bucket, Key: storageKey }));
  const options = { databaseUrl, exportRoot, objectStorage, operationId, storageKey,
    caseId: "S3-EXPORT-CASE", actor: "Test operator" };
  await assert.rejects(exportS3Versions(options), /Pause file writes/);
  await setFileWriteMode({ databaseUrl, mode: "pause" });
  const result = await exportS3Versions(options);
  assert.equal(result.versionCount, 3);
  assert.equal(result.alreadyExported, false);
  const raw = await readFile(join(exportRoot, result.manifestPath));
  assert.equal(createHash("sha256").update(raw).digest("hex"), result.manifestSha256);
  const manifest = JSON.parse(raw);
  assert.equal(manifest.versioning, "Enabled");
  assert.equal(manifest.versions.filter((entry) => entry.kind === "object").length, 2);
  assert.equal(manifest.versions.filter((entry) => entry.kind === "delete-marker").length, 1);
  const recovered = [];
  for (const entry of manifest.versions) {
    if (entry.kind === "delete-marker") {
      assert.equal(entry.file, null);
      continue;
    }
    const bytes = await readFile(join(exportRoot, operationId,
      createHash("sha256").update(storageKey).digest("hex"), entry.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    recovered.push(bytes.toString());
  }
  assert.deepEqual(recovered.sort(), [first.toString(), second.toString()].sort());
  const [logged] = await sql`SELECT manifest_sha256, manifest, case_id FROM file_write_s3_exports
    WHERE operation_id = ${operationId}`;
  assert.equal(logged.manifest_sha256, result.manifestSha256);
  assert.deepEqual(logged.manifest, manifest);
  assert.equal(logged.case_id, "S3-EXPORT-CASE");
  await assert.rejects(sql`DELETE FROM file_write_s3_exports WHERE operation_id = ${operationId}`, /append-only/);
  const cli = spawnSync(process.execPath, ["scripts/file-write-s3-export.mjs", operationId,
    storageKey, "S3-EXPORT-CASE", "Test operator"], {
    env: { ...process.env, ...fixture.environment, DATABASE_URL: databaseUrl,
      FILE_WRITE_S3_EXPORT_ROOT: exportRoot }, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).alreadyExported, true);
  await assert.rejects(exportS3Versions({ ...options, caseId: "OTHER-CASE" }), /manifest differs|audit does not match/);
  await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: storageKey, Body: first }));
  await assert.rejects(exportS3Versions(options), /manifest differs/);
  assert.equal((await sql`SELECT manifest_sha256 FROM file_write_s3_exports WHERE operation_id = ${operationId}`)[0].manifest_sha256,
    result.manifestSha256);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "status" })).pending, 1);
});
