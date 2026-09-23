import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { inspectStorageTransfer, transferDocumentStorage } from "./storage-transfer.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("storage transfer resumes all retained references in both directions without replacing conflicting bytes", { timeout: 30_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `crm_storage_transfer_test_${randomUUID().replaceAll("-", "")}`;
  const storageRoot = await mkdtemp(join(tmpdir(), "crm-transfer-local-"));
  const fixture = await startS3Fixture();
  const objectStorage = createS3Storage(fixture.environment);
  const auditStorage = createS3AuditStorage(fixture.environment);
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const sql = postgres(databaseUrl, { max: 1 });
  t.after(async () => {
    await sql.end();
    try { await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); objectStorage.close(); auditStorage.close(); await fixture.close();
      await rm(storageRoot, { recursive: true, force: true }); }
  });
  await runMigrations({ databaseUrl, onApplied: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone)
    VALUES ('Transfer fixture', 'Europe/Moscow') RETURNING id`;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organization.id}, 'Transfer tester', 'transfer@example.invalid', 'admin') RETURNING id`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, primary_phone)
    VALUES (${organization.id}, 'Transfer customer', '+70000000000') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organization.id}, ${client.id}, 'Transfer object', 'Office', 'Test address') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${organization.id}, ${client.id}, ${object.id}, 'transfer-1', 'new', 'RUB',
      'Transfer customer', 'Transfer object', 'Test address') RETURNING id`;
  const documentId = randomUUID();
  const templateId = randomUUID();
  await sql`INSERT INTO documents (id, organization_id, client_id, object_id, order_id, title, category, created_by, archived_at)
    VALUES (${documentId}, ${organization.id}, ${client.id}, ${object.id}, ${order.id}, 'Archived document', 'other', ${member.id}, now())`;
  await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by, active)
    VALUES (${templateId}, ${organization.id}, 'Inactive template', 'closing_act', ${member.id}, false)`;
  const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, created_by)
    VALUES (${organization.id}, 'Transfer channel', 'group', ${member.id}) RETURNING id`;
  const messageId = randomUUID();
  await sql`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body, deleted_at)
    VALUES (${messageId}, ${organization.id}, ${channel.id}, ${member.id}, 'Deleted message attachment', now())`;
  const original = [];
  for (const [table, recordId, version] of [
    ["document_versions", documentId, 1], ["document_versions", documentId, 2],
    ["document_template_versions", templateId, 1],
    ["chat_message_attachments", messageId, 1], ["chat_channel_avatars", channel.id, 1],
  ]) {
    const extension = table === "chat_channel_avatars" ? "png" : "pdf";
    const bytes = Buffer.from(`${table} retained version ${version}`);
    const key = `${organization.id}/${recordId}/v${version}.${extension}`;
    const path = join(storageRoot, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { mode: 0o600 });
    const fields = { organization_id: organization.id, storage_key: key, size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), uploaded_by: member.id,
      mime_type: extension === "png" ? "image/png" : "application/pdf" };
    if (table === "chat_channel_avatars") Object.assign(fields, { channel_id: recordId });
    else Object.assign(fields, { id: randomUUID(), original_filename: `test.${extension}`, extension });
    if (table === "document_versions") Object.assign(fields, { document_id: recordId, version_number: version });
    if (table === "document_template_versions") Object.assign(fields, { template_id: recordId, version_number: version });
    if (table === "chat_message_attachments") Object.assign(fields, { message_id: recordId });
    await sql`INSERT INTO ${sql(table)} ${sql(fields)}`;
    original.push({ key, path, bytes, fields });
  }
  const forwardId = randomUUID();
  const forward = { databaseUrl, storageRoot, objectStorage, auditStorage, transferId: forwardId,
    direction: "local_to_s3", caseId: "TRANSFER-FORWARD", actor: "Test operator" };
  await assert.rejects(transferDocumentStorage(forward), /Pause file writes/);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "pause" })).drained, true);
  let copies = 0;
  await assert.rejects(transferDocumentStorage({ ...forward, onStage(stage) {
    if (stage === "copied" && ++copies === 2) throw new Error("Crash after destination verification");
  } }), /Crash after destination verification/);
  assert.equal((await sql`SELECT state FROM file_storage_transfers WHERE id = ${forwardId}`)[0].state, "prepared");
  const checkpoint = await inspectStorageTransfer({ databaseUrl, transferId: forwardId });
  assert.equal(checkpoint.fileCount, 5);
  assert.equal(checkpoint.completedFiles, 1);
  assert.equal(checkpoint.pendingFiles, 4);
  assert.ok(checkpoint.nextPendingKey);
  const inspectCli = spawnSync(process.execPath, ["scripts/storage-transfer.mjs", "inspect", forwardId], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 5_000,
  });
  assert.equal(inspectCli.status, 0, inspectCli.stderr);
  assert.equal(JSON.parse(inspectCli.stdout).completedFiles, 1);
  const changedReferenceId = randomUUID();
  const changedKey = `${organization.id}/${templateId}/v9.pdf`;
  await sql`INSERT INTO document_template_versions
    (id, organization_id, template_id, version_number, storage_key, original_filename,
      extension, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${changedReferenceId}, ${organization.id}, ${templateId}, 9, ${changedKey},
      'changed.pdf', 'pdf', 'application/pdf', 1, ${"a".repeat(64)}, ${member.id})`;
  await assert.rejects(transferDocumentStorage(forward), /prepared reference inventory/);
  await sql`DELETE FROM document_template_versions WHERE id = ${changedReferenceId}`; // Disposable fixture only.
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "status" })).transfersPending, 1);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unfinished file storage transfer/);
  const completedForward = await transferDocumentStorage(forward);
  assert.equal(completedForward.fileCount, 5);
  assert.deepEqual(completedForward.referenceCounts, {
    document_versions: 2, document_template_versions: 1,
    chat_message_attachments: 1, chat_channel_avatars: 1,
  });
  assert.equal((await transferDocumentStorage(forward)).alreadyComplete, true);
  const finalCheckpoint = await inspectStorageTransfer({ databaseUrl, transferId: forwardId });
  assert.equal(finalCheckpoint.state, "complete");
  assert.equal(finalCheckpoint.completedFiles, 5);
  assert.equal(finalCheckpoint.pendingFiles, 0);
  for (const item of original) {
    assert.deepEqual(await readFile(item.path), item.bytes, "Local source remains unchanged");
    assert.deepEqual(await objectStorage.readVerified(item.key,
      { sizeBytes: item.bytes.length, sha256: item.fields.sha256 }, 15 * 1024 * 1024), item.bytes);
  }
  await assert.rejects(sql`DELETE FROM file_storage_transfers WHERE id = ${forwardId}`, /append-only/);

  await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket,
    VersioningConfiguration: { Status: "Enabled" } }));
  const duplicate = await fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket,
    Key: original[0].key, Body: original[0].bytes }));
  await assert.rejects(transferDocumentStorage({ ...forward, transferId: randomUUID(),
    caseId: "HIDDEN-HISTORY" }), /unexpected object versions/);
  await fixture.client.send(new DeleteObjectCommand({ Bucket: fixture.bucket,
    Key: original[0].key, VersionId: duplicate.VersionId }));

  const newKey = `${organization.id}/${documentId}/v3.pdf`;
  const newBytes = Buffer.from("New S3 file created after cutover");
  const newSha = createHash("sha256").update(newBytes).digest("hex");
  await objectStorage.write(newKey, newBytes);
  await sql`INSERT INTO document_versions
    (id, organization_id, document_id, version_number, storage_key, original_filename,
      extension, mime_type, size_bytes, sha256, uploaded_by)
    VALUES (${randomUUID()}, ${organization.id}, ${documentId}, 3, ${newKey}, 'new.pdf',
      'pdf', 'application/pdf', ${newBytes.length}, ${newSha}, ${member.id})`;
  const localNew = join(storageRoot, newKey);
  await writeFile(localNew, Buffer.from("conflicting local bytes"));
  const reverseId = randomUUID();
  const reverse = { databaseUrl, storageRoot, objectStorage, auditStorage, transferId: reverseId,
    direction: "s3_to_local", caseId: "TRANSFER-REVERSE", actor: "Test operator" };
  await assert.rejects(transferDocumentStorage(reverse), /Restored file size or type|checksum/);
  assert.deepEqual(await readFile(localNew), Buffer.from("conflicting local bytes"));
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "status" })).transfersPending, 1);
  await assert.rejects(setFileWriteMode({ databaseUrl, mode: "resume" }), /unfinished file storage transfer/);
  await rm(localNew); // Disposable conflict fixture only; transfer never overwrites a conflicting destination.
  await assert.rejects(transferDocumentStorage({ ...reverse, onStage(stage) {
    if (stage === "before_complete") throw new Error("Crash before transfer completion marker");
  } }), /Crash before transfer completion marker/);
  assert.equal((await sql`SELECT state FROM file_storage_transfers WHERE id = ${reverseId}`)[0].state, "prepared");
  const completedReverse = await transferDocumentStorage(reverse);
  assert.equal(completedReverse.fileCount, 6);
  assert.deepEqual(await readFile(localNew), newBytes);
  assert.deepEqual(await objectStorage.readVerified(newKey,
    { sizeBytes: newBytes.length, sha256: newSha }, 15 * 1024 * 1024), newBytes);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
});
