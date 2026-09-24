import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { quarantineFileWrite } from "./file-write-quarantine.mjs";
import { exportQuarantineCopy } from "./file-write-quarantine-export.mjs";
import { reviewOrResolveFileWrite } from "./file-write-recovery.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("local quarantine preserves unreferenced bytes across copy/unlink interruptions", { timeout: 20_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_file_quarantine_test_${randomUUID().replaceAll("-", "")}`;
  const storageRoot = await mkdtemp(join(tmpdir(), "crm-quarantine-storage-"));
  const quarantineRoot = await mkdtemp(join(tmpdir(), "crm-quarantine-private-"));
  const exportRoot = await mkdtemp(join(tmpdir(), "crm-quarantine-export-"));
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); await rm(storageRoot, { recursive: true, force: true });
      await rm(quarantineRoot, { recursive: true, force: true }); await rm(exportRoot, { recursive: true, force: true }); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  const organizationId = randomUUID();
  const key = `${organizationId}/${randomUUID()}/v1.pdf`;
  const operationId = randomUUID();
  const sourcePath = join(storageRoot, key);
  const bytes = Buffer.from("%PDF-1.4\nQuarantine fixture\n");
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes, { mode: 0o600 });
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${operationId}, ${[key]})`;
  const options = { databaseUrl, storageRoot, quarantineRoot, operationId, storageKey: key,
    caseId: "RECOVERY-QUARANTINE", actor: "Test operator" };
  await assert.rejects(quarantineFileWrite(options), /Pause file writes/);
  await setFileWriteMode({ databaseUrl, mode: "pause" });
  await assert.rejects(quarantineFileWrite({ ...options, onStage(stage) {
    if (stage === "copied") throw new Error("Crash after verified copy");
  } }), /Crash after verified copy/);
  assert.deepEqual(await readFile(sourcePath), bytes);
  const [prepared] = await sql`SELECT quarantine_path, state, sha256 FROM file_write_quarantine WHERE operation_id = ${operationId}`;
  assert.equal(prepared.state, "prepared");
  assert.equal(prepared.sha256, createHash("sha256").update(bytes).digest("hex"));
  const quarantinePath = join(quarantineRoot, prepared.quarantine_path);
  assert.deepEqual(await readFile(quarantinePath), bytes);
  await assert.rejects(quarantineFileWrite({ ...options, caseId: "DIFFERENT-CASE" }), /does not match/);
  await assert.rejects(quarantineFileWrite({ ...options, onStage(stage) {
    if (stage === "source_unlinked") throw new Error("Crash before completed marker");
  } }), /Crash before completed marker/);
  await assert.rejects(readFile(sourcePath), { code: "ENOENT" });
  assert.deepEqual(await readFile(quarantinePath), bytes);
  assert.equal((await sql`SELECT state FROM file_write_quarantine WHERE operation_id = ${operationId}`)[0].state, "prepared");
  const completed = await quarantineFileWrite(options);
  assert.equal(completed.completed, true);
  assert.equal(completed.alreadyComplete, false);
  assert.equal((await quarantineFileWrite(options)).alreadyComplete, true);
  assert.deepEqual(await readFile(quarantinePath), bytes);
  await assert.rejects(sql`DELETE FROM file_write_quarantine WHERE operation_id = ${operationId}`, /append-only/);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unresolved file write/);

  const preparedKey = `${organizationId}/${randomUUID()}/v1.pdf`;
  const preparedOperationId = randomUUID();
  const preparedSourcePath = join(storageRoot, preparedKey);
  await mkdir(dirname(preparedSourcePath), { recursive: true });
  await writeFile(preparedSourcePath, bytes);
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${preparedOperationId}, ${[preparedKey]})`;
  const preparedOptions = { ...options, operationId: preparedOperationId, storageKey: preparedKey,
    caseId: "RECOVERY-PREPARED" };
  await assert.rejects(quarantineFileWrite({ ...preparedOptions, onStage(stage) {
    if (stage === "prepared") throw new Error("Crash before copy");
  } }), /Crash before copy/);
  assert.deepEqual(await readFile(preparedSourcePath), bytes);
  assert.equal((await sql`SELECT state FROM file_write_quarantine WHERE operation_id = ${preparedOperationId}`)[0].state, "prepared");
  const preparedCompleted = await quarantineFileWrite(preparedOptions);
  assert.equal(preparedCompleted.completed, true);
  await assert.rejects(readFile(preparedSourcePath), { code: "ENOENT" });
  const preparedReview = await reviewOrResolveFileWrite({ databaseUrl, storageRoot, quarantineRoot, operationId: preparedOperationId });
  assert.equal(preparedReview.entries[0].state, "quarantined_verified");
  await reviewOrResolveFileWrite({ databaseUrl, storageRoot, quarantineRoot, operationId: preparedOperationId,
    reviewSha256: preparedReview.reviewSha256,
    evidenceSha256: createHash("sha256").update("private case evidence").digest("hex"),
    caseId: "RECOVERY-PREPARED", actor: "Test operator" });

  const [organization] = await sql`INSERT INTO organizations (id, name, timezone)
    VALUES (${organizationId}, 'Quarantine fixture', 'Europe/Moscow') RETURNING id`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Quarantine tester', 'quarantine@example.invalid', 'admin') RETURNING id`;
  const templateId = randomUUID();
  await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by)
    VALUES (${templateId}, ${organization.id}, 'Referenced template', 'closing_act', ${member.id})`;
  const referencedKey = `${organization.id}/${templateId}/v1.pdf`;
  const referencedPath = join(storageRoot, referencedKey);
  await mkdir(dirname(referencedPath), { recursive: true });
  await writeFile(referencedPath, bytes);
  await sql`INSERT INTO document_template_versions
    (id, organization_id, template_id, version_number, storage_key, original_filename, extension, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${randomUUID()}, ${organization.id}, ${templateId}, 1, ${referencedKey}, 'reference.pdf', 'pdf', 'application/pdf',
      ${bytes.length}, ${createHash("sha256").update(bytes).digest("hex")}, ${member.id})`;
  const referencedOperationId = randomUUID();
  await sql`INSERT INTO file_write_operations (id, storage_keys) VALUES (${referencedOperationId}, ${[referencedKey]})`;
  await assert.rejects(quarantineFileWrite({ ...options, operationId: referencedOperationId, storageKey: referencedKey }), /committed database reference/);
  assert.deepEqual(await readFile(referencedPath), bytes);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_quarantine WHERE operation_id = ${referencedOperationId}`)[0].count, 0);
  await sql`DELETE FROM file_write_operations WHERE id = ${referencedOperationId}`; // Disposable fixture only.

  const recoveryOptions = { databaseUrl, storageRoot, quarantineRoot, operationId };
  await writeFile(quarantinePath, Buffer.from("damaged quarantine copy"));
  const damagedReview = await reviewOrResolveFileWrite(recoveryOptions);
  assert.equal(damagedReview.entries[0].state, "quarantine_invalid");
  assert.equal(damagedReview.eligibleForManualResolution, false);
  await assert.rejects(exportQuarantineCopy({ databaseUrl, storageRoot, quarantineRoot, exportRoot,
    operationId, storageKey: key, caseId: "RECOVERY-QUARANTINE" }), /checksum/);
  await writeFile(quarantinePath, bytes);
  const verifiedReview = await reviewOrResolveFileWrite(recoveryOptions);
  assert.equal(verifiedReview.entries[0].state, "quarantined_verified");
  await assert.rejects(reviewOrResolveFileWrite({ ...recoveryOptions, reviewSha256: verifiedReview.reviewSha256,
    evidenceSha256: createHash("sha256").update("private case evidence").digest("hex"),
    caseId: "DIFFERENT-CASE", actor: "Test operator" }), /case ID differs/);
  await reviewOrResolveFileWrite({ ...recoveryOptions, reviewSha256: verifiedReview.reviewSha256,
    evidenceSha256: createHash("sha256").update("private case evidence").digest("hex"),
    caseId: "RECOVERY-QUARANTINE", actor: "Test operator" });
  const exportOptions = { databaseUrl, storageRoot, quarantineRoot, exportRoot,
    operationId, storageKey: key, caseId: "RECOVERY-QUARANTINE" };
  await assert.rejects(exportQuarantineCopy({ ...exportOptions, caseId: "WRONG-CASE" }), /matching case ID/);
  await assert.rejects(exportQuarantineCopy({ ...exportOptions, exportRoot: storageRoot }), /must be separate/);
  const exported = await exportQuarantineCopy(exportOptions);
  assert.deepEqual(await readFile(exported.exportPath), bytes);
  assert.equal(exported.sha256, createHash("sha256").update(bytes).digest("hex"));
  await assert.rejects(exportQuarantineCopy(exportOptions), { code: "EEXIST" });
  assert.deepEqual(await readFile(quarantinePath), bytes);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
});
