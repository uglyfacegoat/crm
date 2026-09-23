import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, PutBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { exportS3Versions } from "./file-write-s3-export.mjs";
import { createS3VersionRemover, quarantineS3Versions } from "./file-write-s3-quarantine.mjs";
import { createS3RestoreTarget, restoreS3QuarantineArchive } from "./file-write-s3-restore.mjs";
import { reviewOrResolveFileWrite } from "./file-write-recovery.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("versioned S3 quarantine resumes partial removal only after verified private export", { timeout: 30_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_s3_quarantine_test_${randomUUID().replaceAll("-", "")}`;
  const exportRoot = await mkdtemp(join(tmpdir(), "crm-s3-quarantine-"));
  const fixture = await startS3Fixture();
  const objectStorage = createS3AuditStorage(fixture.environment);
  const versionRemover = createS3VersionRemover({ ...fixture.environment,
    FILE_WRITE_S3_QUARANTINE_ACCESS_KEY_ID: fixture.environment.DOCUMENT_S3_ACCESS_KEY_ID,
    FILE_WRITE_S3_QUARANTINE_SECRET_ACCESS_KEY: fixture.environment.DOCUMENT_S3_SECRET_ACCESS_KEY });
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); objectStorage.close(); versionRemover.close();
      await fixture.close(); await rm(exportRoot, { recursive: true, force: true }); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  const operationId = randomUUID();
  const storageKey = `${randomUUID()}/${randomUUID()}/v1.pdf`;
  const bytes = [Buffer.from("%PDF-1.4\nS3 quarantine first\n"),
    Buffer.from("%PDF-1.4\nS3 quarantine second\n")];
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${operationId}, ${[storageKey]})`;
  await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket,
    VersioningConfiguration: { Status: "Enabled" } }));
  for (const body of bytes) await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket,
    Key: storageKey, Body: body }));
  await fixture.client.send(new DeleteObjectCommand({ Bucket: fixture.bucket, Key: storageKey }));
  const options = { databaseUrl, exportRoot, objectStorage, versionRemover,
    operationId, storageKey, caseId: "S3-QUARANTINE", actor: "Test operator" };
  await assert.rejects(quarantineS3Versions(options), /Pause file writes/);
  await setFileWriteMode({ databaseUrl, mode: "pause" });
  const exported = await exportS3Versions(options);
  assert.equal(exported.versionCount, 3);
  const manifest = JSON.parse(await readFile(join(exportRoot, exported.manifestPath)));
  const firstObject = manifest.versions.find((item) => item.kind === "object");
  const file = join(exportRoot, operationId,
    createHash("sha256").update(storageKey).digest("hex"), firstObject.file);
  const original = await readFile(file);
  await writeFile(file, Buffer.from("corrupt copy"));
  await assert.rejects(quarantineS3Versions(options), /version checksum/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_s3_quarantine`)[0].count, 0);
  await writeFile(file, original);
  const deniedRemover = createS3VersionRemover({ ...fixture.environment,
    FILE_WRITE_S3_QUARANTINE_ACCESS_KEY_ID: fixture.environment.DOCUMENT_S3_ACCESS_KEY_ID,
    FILE_WRITE_S3_QUARANTINE_SECRET_ACCESS_KEY: "invalid-fixture-secret" });
  try { await assert.rejects(quarantineS3Versions({ ...options, versionRemover: deniedRemover })); }
  finally { deniedRemover.close(); }
  assert.equal((await sql`SELECT state FROM file_write_s3_quarantine WHERE operation_id = ${operationId}`)[0].state, "prepared");
  const afterDenied = [];
  for await (const item of objectStorage.inventory()) if (item.storageKey === storageKey) afterDenied.push(item);
  assert.equal(afterDenied.length, 3);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unresolved file write/);
  await assert.rejects(quarantineS3Versions({ ...options, onStage(stage) {
    if (stage === "version_deleted") throw new Error("Crash after one version removal");
  } }), /Crash after one version removal/);
  assert.equal((await sql`SELECT state FROM file_write_s3_quarantine WHERE operation_id = ${operationId}`)[0].state, "prepared");
  const afterOne = [];
  for await (const item of objectStorage.inventory()) if (item.storageKey === storageKey) afterOne.push(item);
  assert.equal(afterOne.length, 2);
  await assert.rejects(quarantineS3Versions({ ...options, caseId: "OTHER-CASE" }), /same case/);
  const partialReview = await reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId });
  assert.equal(partialReview.entries[0].state, "unreferenced_present");
  let deleted = 0;
  await assert.rejects(quarantineS3Versions({ ...options, onStage(stage) {
    if (stage === "version_deleted" && ++deleted === 2) throw new Error("Crash before completed marker");
  } }), /Crash before completed marker/);
  const incompleteReview = await reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId });
  assert.equal(incompleteReview.entries[0].state, "quarantine_invalid");
  assert.equal(incompleteReview.eligibleForManualResolution, false);
  const complete = await quarantineS3Versions(options);
  assert.equal(complete.completed, true);
  assert.equal(complete.alreadyComplete, false);
  assert.equal((await quarantineS3Versions(options)).alreadyComplete, true);
  await assert.rejects(sql`DELETE FROM file_write_s3_quarantine WHERE operation_id = ${operationId}`, /append-only/);
  const verifiedReview = await reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId });
  assert.equal(verifiedReview.entries[0].state, "quarantined_verified");
  await assert.rejects(reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId, reviewSha256: verifiedReview.reviewSha256,
    evidenceSha256: createHash("sha256").update("private S3 evidence").digest("hex"),
    caseId: "OTHER-CASE", actor: "Test operator" }), /case ID differs/);
  const resolution = await reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId, reviewSha256: verifiedReview.reviewSha256,
    evidenceSha256: createHash("sha256").update("private S3 evidence").digest("hex"),
    caseId: "S3-QUARANTINE", actor: "Test operator" });
  assert.equal(resolution.resolved, true);
  const archive = manifest.versions.filter((item) => item.kind === "object");
  const recovered = await Promise.all(archive.map((item) => readFile(join(exportRoot, operationId,
    createHash("sha256").update(storageKey).digest("hex"), item.file))));
  assert.deepEqual(recovered.map((item) => item.toString()).sort(), bytes.map((item) => item.toString()).sort());

  const restoreBucket = `crm-restore-${randomUUID()}`;
  await fixture.client.send(new CreateBucketCommand({ Bucket: restoreBucket }));
  const target = createS3RestoreTarget({ ...fixture.environment,
    FILE_WRITE_S3_RESTORE_ENDPOINT: fixture.endpoint,
    FILE_WRITE_S3_RESTORE_REGION: "us-east-1",
    FILE_WRITE_S3_RESTORE_BUCKET: restoreBucket,
    FILE_WRITE_S3_RESTORE_ACCESS_KEY_ID: fixture.environment.DOCUMENT_S3_ACCESS_KEY_ID,
    FILE_WRITE_S3_RESTORE_SECRET_ACCESS_KEY: fixture.environment.DOCUMENT_S3_SECRET_ACCESS_KEY,
    FILE_WRITE_S3_RESTORE_FORCE_PATH_STYLE: "true",
    FILE_WRITE_S3_RESTORE_ALLOW_LOCAL_HTTP: "true",
    FILE_WRITE_S3_RESTORE_TIMEOUT_MS: "3000",
  });
  try {
    const restoreOptions = { databaseUrl, exportRoot, target, operationId, storageKey,
      caseId: "S3-QUARANTINE", actor: "Test operator" };
    const restored = await restoreS3QuarantineArchive(restoreOptions);
    assert.equal(restored.versions.filter((item) => item.kind === "object").length, 2);
    assert.equal(restored.versions.filter((item) => item.kind === "delete-marker").length, 1);
    for (const item of restored.versions.filter((entry) => entry.targetKey)) {
      const response = await fixture.client.send(new GetObjectCommand({ Bucket: restoreBucket, Key: item.targetKey }));
      const targetBytes = Buffer.from(await response.Body.transformToByteArray());
      assert.equal(targetBytes.length, item.sizeBytes);
      assert.equal(createHash("sha256").update(targetBytes).digest("hex"), item.sha256);
    }
    assert.equal((await restoreS3QuarantineArchive(restoreOptions)).alreadyRestored, true);
    await assert.rejects(restoreS3QuarantineArchive({ ...restoreOptions, caseId: "WRONG-CASE" }), /same case/);
    await assert.rejects(sql`DELETE FROM file_write_s3_restore_drills WHERE operation_id = ${operationId}`, /append-only/);
    const firstRestored = restored.versions.find((entry) => entry.targetKey);
    await fixture.client.send(new PutObjectCommand({ Bucket: restoreBucket,
      Key: firstRestored.targetKey, Body: Buffer.from("corrupt restore target") }));
    await assert.rejects(restoreS3QuarantineArchive(restoreOptions), /Object storage write failed/);
  } finally { target.close(); }

  const organizationId = randomUUID();
  const templateId = randomUUID();
  const referencedKey = `${organizationId}/${templateId}/v1.pdf`;
  await sql`INSERT INTO organizations (id, name, timezone)
    VALUES (${organizationId}, 'S3 quarantine fixture', 'Europe/Moscow')`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organizationId}, 'S3 quarantine tester', 's3-quarantine@example.invalid', 'admin') RETURNING id`;
  await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by)
    VALUES (${templateId}, ${organizationId}, 'Referenced template', 'closing_act', ${member.id})`;
  await sql`INSERT INTO document_template_versions
    (id, organization_id, template_id, version_number, storage_key, original_filename, extension, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${randomUUID()}, ${organizationId}, ${templateId}, 1, ${referencedKey}, 'reference.pdf', 'pdf', 'application/pdf',
      ${bytes[0].length}, ${createHash("sha256").update(bytes[0]).digest("hex")}, ${member.id})`;
  const referencedOperationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${referencedOperationId}, ${[referencedKey]})`;
  await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: referencedKey, Body: bytes[0] }));
  await assert.rejects(quarantineS3Versions({ ...options, operationId: referencedOperationId,
    storageKey: referencedKey }), /committed reference/);
  const referencedInventory = [];
  for await (const item of objectStorage.inventory()) if (item.storageKey === referencedKey) referencedInventory.push(item);
  assert.equal(referencedInventory.length, 1);
  await sql`DELETE FROM file_write_operations WHERE id = ${referencedOperationId}`; // Disposable fixture only.

  const outsideKey = `${randomUUID()}/${randomUUID()}/v1.pdf`;
  const outsideOperationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${outsideOperationId}, ${[outsideKey]})`;
  await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket,
    Key: outsideKey, Body: bytes[0] }));
  await exportS3Versions({ ...options, operationId: outsideOperationId, storageKey: outsideKey,
    caseId: "OUTSIDE-CASE" });
  const outsideVersions = [];
  for await (const item of objectStorage.inventory()) if (item.storageKey === outsideKey) outsideVersions.push(item);
  for (const item of outsideVersions) await versionRemover.removeVersion(outsideKey, item.versionId);
  const outsideReview = await reviewOrResolveFileWrite({ databaseUrl, objectStorage,
    s3ExportRoot: exportRoot, operationId: outsideOperationId });
  assert.equal(outsideReview.entries[0].state, "quarantine_invalid",
    "External removal must not bypass the completed-quarantine record");
  await sql`DELETE FROM file_write_operations WHERE id = ${outsideOperationId}`; // Disposable fixture only.
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
});
