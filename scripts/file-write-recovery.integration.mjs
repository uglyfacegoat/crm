import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { reviewOrResolveFileWrite } from "./file-write-recovery.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");
const evidenceSha256 = createHash("sha256").update("private operator evidence").digest("hex");

test("local and S3 file-write recovery review bytes and record only audited, paused resolutions", { timeout: 20_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_file_recovery_test_${randomUUID().replaceAll("-", "")}`;
  const storageRoot = await mkdtemp(join(tmpdir(), "crm-file-recovery-"));
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "crm-file-evidence-"));
  const evidencePath = join(evidenceDirectory, "case.txt");
  await writeFile(evidencePath, "private operator evidence", { mode: 0o600 });
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); await rm(storageRoot, { recursive: true, force: true }); await rm(evidenceDirectory, { recursive: true, force: true }); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  const options = (operationId) => ({ databaseUrl, storageRoot, operationId });
  const resolveOptions = (operationId, reviewSha256) => ({ ...options(operationId), reviewSha256,
    evidenceSha256, caseId: "RECOVERY-123", actor: "Test operator" });
  const operationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id) VALUES (${operationId})`;
  await assert.rejects(reviewOrResolveFileWrite(options(operationId)), /Pause file writes/);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "pause" })).drained, false);
  const emptyReview = await reviewOrResolveFileWrite(options(operationId));
  assert.equal(emptyReview.eligibleForManualResolution, true);
  assert.deepEqual(emptyReview.entries, []);
  await assert.rejects(reviewOrResolveFileWrite(resolveOptions(operationId, "0".repeat(64))), /review changed/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations`)[0].count, 1);
  const cliArgs = ["scripts/file-write-recovery.mjs", "resolve", operationId,
    emptyReview.reviewSha256, "RECOVERY-123", evidencePath, "Test", "operator"];
  const cliEnvironment = { ...process.env, DATABASE_URL: databaseUrl, DOCUMENT_STORAGE_ROOT: storageRoot, DOCUMENT_STORAGE_BACKEND: "local" };
  const cliResolution = spawnSync(process.execPath, cliArgs, {
    env: cliEnvironment,
    encoding: "utf8", timeout: 5_000,
  });
  assert.equal(cliResolution.status, 0, cliResolution.stderr);
  assert.equal(JSON.parse(cliResolution.stdout).resolved, true);
  const repeatedCliResolution = spawnSync(process.execPath, cliArgs, { env: cliEnvironment, encoding: "utf8", timeout: 5_000 });
  assert.equal(repeatedCliResolution.status, 0, repeatedCliResolution.stderr);
  assert.equal(JSON.parse(repeatedCliResolution.stdout).alreadyResolved, true);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations`)[0].count, 0);
  const [logged] = await sql`SELECT review, review_sha256, evidence_sha256, case_id, actor, database_role
    FROM file_write_resolutions WHERE operation_id = ${operationId}`;
  assert.deepEqual(logged.review, { operationId, startedAt: emptyReview.startedAt,
    backend: "local", bucketVersioning: null, storageKeys: [], entries: [] });
  assert.deepEqual({ review_sha256: logged.review_sha256, evidence_sha256: logged.evidence_sha256,
    case_id: logged.case_id, actor: logged.actor }, { review_sha256: emptyReview.reviewSha256, evidence_sha256: evidenceSha256,
    case_id: "RECOVERY-123", actor: "Test operator" });
  assert.ok(logged.database_role);
  await assert.rejects(sql`UPDATE file_write_resolutions SET actor = 'Changed' WHERE operation_id = ${operationId}`, /append-only/);
  await assert.rejects(sql`DELETE FROM file_write_resolutions WHERE operation_id = ${operationId}`, /append-only/);
  assert.equal((await reviewOrResolveFileWrite(resolveOptions(operationId, emptyReview.reviewSha256))).alreadyResolved, true);
  await assert.rejects(reviewOrResolveFileWrite({ ...resolveOptions(operationId, emptyReview.reviewSha256),
    evidenceSha256: "1".repeat(64) }), /different evidence/);

  const [organization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Recovery fixture', 'Europe/Moscow') RETURNING id`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Recovery tester', 'recovery@example.invalid', 'admin') RETURNING id`;
  const [template] = await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by)
    VALUES (${randomUUID()}, ${organization.id}, 'Recovery template', 'closing_act', ${member.id}) RETURNING id`;
  const key = `${organization.id}/${template.id}/v1.pdf`;
  const path = join(storageRoot, key);
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from("%PDF-1.4\nRecovery fixture\n");
  await writeFile(path, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const referencedOperationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${referencedOperationId}, ${[key]})`;
  const presentReview = await reviewOrResolveFileWrite(options(referencedOperationId));
  assert.equal(presentReview.entries[0].state, "unreferenced_present");
  assert.equal(presentReview.eligibleForManualResolution, false);
  await assert.rejects(reviewOrResolveFileWrite(resolveOptions(referencedOperationId, presentReview.reviewSha256)), /separate preservation/);
  await sql`INSERT INTO document_template_versions
    (id, organization_id, template_id, version_number, storage_key, original_filename, extension, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${randomUUID()}, ${organization.id}, ${template.id}, 1, ${key}, 'fixture.pdf', 'pdf', 'application/pdf', ${bytes.length}, ${sha256}, ${member.id})`;
  const referencedReview = await reviewOrResolveFileWrite(options(referencedOperationId));
  assert.equal(referencedReview.entries[0].state, "referenced_verified");
  await assert.rejects(reviewOrResolveFileWrite(resolveOptions(referencedOperationId, presentReview.reviewSha256)), /review changed/);
  await writeFile(path, Buffer.from("damaged"));
  const damagedReview = await reviewOrResolveFileWrite(options(referencedOperationId));
  assert.equal(damagedReview.entries[0].state, "reference_invalid");
  await assert.rejects(reviewOrResolveFileWrite(resolveOptions(referencedOperationId, damagedReview.reviewSha256)), /separate preservation/);
  await writeFile(path, bytes);
  const verifiedReview = await reviewOrResolveFileWrite(options(referencedOperationId));
  assert.equal(verifiedReview.reviewSha256, referencedReview.reviewSha256);
  await reviewOrResolveFileWrite(resolveOptions(referencedOperationId, verifiedReview.reviewSha256));
  assert.deepEqual(await readFile(path), bytes, "Resolution never removes storage bytes");

  const secondKey = `${organization.id}/${randomUUID()}/v1.pdf`;
  const secondPath = join(storageRoot, secondKey);
  await mkdir(dirname(secondPath), { recursive: true });
  await writeFile(secondPath, Buffer.from("Unreferenced fixture"));
  const multiOperationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${multiOperationId}, ${[key, secondKey]})`;
  const multiReview = await reviewOrResolveFileWrite(options(multiOperationId));
  assert.deepEqual(multiReview.entries.map(({ state }) => state), ["referenced_verified", "unreferenced_present"]);
  await assert.rejects(reviewOrResolveFileWrite(resolveOptions(multiOperationId, multiReview.reviewSha256)), /separate preservation/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE id = ${multiOperationId}`)[0].count, 1);
  await unlink(secondPath); // Disposable fixture only; production quarantine still needs its own acceptance.
  const multiAfterQuarantine = await reviewOrResolveFileWrite(options(multiOperationId));
  assert.deepEqual(multiAfterQuarantine.entries.map(({ state }) => state), ["referenced_verified", "absent_unreferenced"]);
  await reviewOrResolveFileWrite(resolveOptions(multiOperationId, multiAfterQuarantine.reviewSha256));
  const { startS3Fixture } = await import("./fixtures/s3-server.mjs");
  const { createS3AuditStorage } = await import("./s3-audit-storage.mjs");
  const { DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const fixture = await startS3Fixture();
  const objectStorage = createS3AuditStorage(fixture.environment);
  try {
    await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: key, Body: bytes }));
    const s3OperationId = randomUUID();
    await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${s3OperationId}, ${[key]})`;
    const s3Options = (operationId) => ({ ...options(operationId), objectStorage });
    const s3Review = await reviewOrResolveFileWrite(s3Options(s3OperationId));
    assert.equal(s3Review.backend, "s3");
    assert.equal(s3Review.entries[0].state, "referenced_verified");
    assert.equal(s3Review.entries[0].versionCount, 1);
    await reviewOrResolveFileWrite({ ...s3Options(s3OperationId), reviewSha256: s3Review.reviewSha256,
      evidenceSha256, caseId: "RECOVERY-S3", actor: "Test operator" });

    const unreferencedKey = `${organization.id}/${randomUUID()}/v1.pdf`;
    await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: unreferencedKey, Body: bytes }));
    const unreferencedOperationId = randomUUID();
    await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${unreferencedOperationId}, ${[unreferencedKey]})`;
    const s3Present = await reviewOrResolveFileWrite(s3Options(unreferencedOperationId));
    assert.equal(s3Present.entries[0].state, "unreferenced_present");
    await assert.rejects(reviewOrResolveFileWrite({ ...s3Options(unreferencedOperationId), reviewSha256: s3Present.reviewSha256,
      evidenceSha256, caseId: "RECOVERY-S3", actor: "Test operator" }), /separate preservation/);
    await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket,
      VersioningConfiguration: { Status: "Enabled" } }));
    await fixture.client.send(new DeleteObjectCommand({ Bucket: fixture.bucket, Key: unreferencedKey }));
    const markedReview = await reviewOrResolveFileWrite(s3Options(unreferencedOperationId));
    assert.equal(markedReview.bucketVersioning, "Enabled");
    assert.equal(markedReview.entries[0].state, "unreferenced_present", "A delete marker must not hide retained historical bytes");
    assert.ok(markedReview.entries[0].versionCount >= 2);
    assert.notEqual(markedReview.reviewSha256, s3Present.reviewSha256);
    const cli = spawnSync(process.execPath, ["scripts/file-write-recovery.mjs", "review", unreferencedOperationId], {
      env: { ...process.env, ...fixture.environment, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 5_000,
    });
    assert.equal(cli.status, 2, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).backend, "s3");
    await sql`DELETE FROM file_write_operations WHERE id = ${unreferencedOperationId}`; // Disposable fixture only.
  } finally { objectStorage.close(); await fixture.close(); }
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
});
