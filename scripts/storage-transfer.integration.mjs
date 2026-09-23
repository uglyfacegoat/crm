import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { DeleteObjectCommand, PutBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { unzipSync } from "fflate";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { auditStorage as auditFiles } from "./storage-audit.mjs";
import { inspectStorageTransfer, transferDocumentStorage } from "./storage-transfer.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL with CREATEDB privileges.");

test("storage transfer resumes all retained references in both directions without replacing conflicting bytes", { timeout: 90_000 }, async (t) => {
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
  const localAuditAfterForward = await auditFiles({ sql, storageRoot,
    onRecord: async () => {} });
  const s3AuditAfterForward = await auditFiles({ sql, objectStorage: auditStorage,
    onRecord: async () => {} });
  assert.equal(localAuditAfterForward.verifiedReferences, 5);
  assert.equal(s3AuditAfterForward.verifiedReferences, 5);
  assert.equal(localAuditAfterForward.hasFindings, false);
  assert.equal(s3AuditAfterForward.hasFindings, false);
  await assert.rejects(sql`DELETE FROM file_storage_transfers WHERE id = ${forwardId}`, /append-only/);

  if (process.env.STORAGE_CUTOVER_TEST_RUNTIME && process.env.STORAGE_CUTOVER_TEST_IMAGE) {
    await t.test("web and backup worker switch together and restore the same historical bytes", async () => {
      const dockerAdminUrl = process.env.STORAGE_CUTOVER_TEST_DOCKER_ADMIN_URL;
      if (!dockerAdminUrl) throw new Error("Set STORAGE_CUTOVER_TEST_DOCKER_ADMIN_URL for the disposable database reachable from Docker.");
      const dockerDatabaseUrl = new URL(dockerAdminUrl);
      dockerDatabaseUrl.pathname = `/${name}`;
      const portServer = createServer();
      await new Promise(resolved => portServer.listen(0, "127.0.0.1", resolved));
      const port = portServer.address().port;
      await new Promise(resolved => portServer.close(resolved));
      const baseUrl = `http://127.0.0.1:${port}`;
      const loginEmail = `cutover-${randomUUID()}@example.invalid`;
      const loginPassword = randomBytes(32).toString("hex");
      const adminCreation = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
        env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_MEMBER_ORGANIZATION_ID: organization.id,
          AUTH_MEMBER_NAME: "Cutover tester", AUTH_MEMBER_EMAIL: loginEmail,
          AUTH_MEMBER_PASSWORD: loginPassword, AUTH_MEMBER_ROLE: "admin" },
        encoding: "utf8", timeout: 30_000,
      });
      assert.equal(adminCreation.status, 0, adminCreation.stderr);
      const webEnvironment = {
        ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "production", AUTH_MODE: "required",
        AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), CRM_ALLOWED_ORIGINS: baseUrl,
        AUTH_COOKIE_SECURE: "false", CRM_TRUST_PROXY: "false", CRM_WEBSITE_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
        DOCUMENT_STORAGE_ROOT: storageRoot, HOSTNAME: "127.0.0.1", PORT: String(port), NEXT_TELEMETRY_DISABLED: "1",
      };
      let web;
      const startWeb = async (backend) => {
        const environment = backend === "s3"
          ? { ...webEnvironment, ...fixture.environment }
          : { ...webEnvironment, DOCUMENT_STORAGE_BACKEND: "local" };
        web = spawn(process.execPath, [resolve(process.env.STORAGE_CUTOVER_TEST_RUNTIME)], {
          env: environment, stdio: ["ignore", "ignore", "pipe"],
        });
        let errors = "";
        web.stderr.on("data", chunk => { errors = `${errors}${chunk}`.slice(-2000); });
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (web.exitCode !== null || web.signalCode !== null) throw new Error(`Cutover web exited before ready: ${errors}`);
          try {
            if ((await fetch(`${baseUrl}/api/v1/system/health`, { signal: AbortSignal.timeout(1000) })).ok) return;
          } catch { /* Wait for the disposable server to bind. */ }
          await new Promise(done => setTimeout(done, 100));
        }
        throw new Error(`Cutover web startup timed out: ${errors}`);
      };
      const stopWeb = async () => {
        if (web && web.exitCode === null && web.signalCode === null) {
          const exit = once(web, "exit");
          web.kill("SIGTERM");
          await exit;
        }
        web = undefined;
      };
      const verifyHttpFiles = async () => {
        const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: "POST", headers: { origin: baseUrl, "content-type": "application/json" },
          body: JSON.stringify({ identity: loginEmail, password: loginPassword }),
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
        assert.ok(cookie);
        const headers = { cookie, origin: baseUrl };
        const versions = await sql`SELECT id, version_number FROM document_versions WHERE document_id = ${documentId} ORDER BY version_number`;
        for (const version of versions) {
          const response = await fetch(`${baseUrl}/api/v1/documents/${documentId}/versions/${version.id}/download`, { headers });
          assert.equal(response.status, 200);
          assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.find(item => item.fields.document_id === documentId && item.fields.version_number === version.version_number).bytes);
        }
        const latest = original.find(item => item.fields.document_id === documentId && item.fields.version_number === 2).bytes;
        const current = await fetch(`${baseUrl}/api/v1/documents/${documentId}/download`, { headers });
        assert.equal(current.status, 200);
        assert.deepEqual(Buffer.from(await current.arrayBuffer()), latest);
        const exported = await fetch(`${baseUrl}/api/v1/documents/export`, {
          method: "POST", headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ documentIds: [documentId] }),
        });
        assert.equal(exported.status, 200);
        const files = Object.values(unzipSync(new Uint8Array(await exported.arrayBuffer())));
        assert.equal(files.length, 1);
        assert.deepEqual(Buffer.from(files[0]), latest);
      };
      const volume = `crm-cutover-backup-${randomUUID()}`;
      try {
        const [latestVersion] = await sql`SELECT id FROM document_versions WHERE document_id = ${documentId} AND version_number = 2`;
        await sql`UPDATE documents SET archived_at = NULL, current_version_id = ${latestVersion.id} WHERE id = ${documentId}`;
        await startWeb("local");
        await verifyHttpFiles();
        await stopWeb();
        await startWeb("s3");
        await verifyHttpFiles();
        const createdVolume = spawnSync("docker", ["volume", "create", volume], { encoding: "utf8" });
        assert.equal(createdVolume.status, 0, createdVolume.stderr);
        const ownership = spawnSync("docker", ["run", "--rm", "--mount", `type=volume,source=${volume},target=/app/backups`,
          "--user", "root", "--entrypoint", "chown", process.env.STORAGE_CUTOVER_TEST_IMAGE, "1001:1001", "/app/backups"], { encoding: "utf8" });
        assert.equal(ownership.status, 0, ownership.stderr);
        const workerEnvironment = { ...process.env, DATABASE_URL: dockerDatabaseUrl.toString(),
          ...fixture.environment, DOCUMENT_S3_ENDPOINT: "http://127.0.0.1:9000",
          DOCUMENT_STORAGE_ROOT: "/app/storage", BACKUP_ROOT: "/app/backups" };
        const workerKeys = ["DATABASE_URL", ...Object.keys(fixture.environment), "DOCUMENT_STORAGE_ROOT", "BACKUP_ROOT"];
        const runWorker = (command, args = []) => spawnSync("docker", ["run", "--rm", "--network", `container:${fixture.containerName}`,
          "--mount", `type=volume,source=${volume},target=/app/backups`,
          ...workerKeys.flatMap(key => ["--env", key]), "--entrypoint", "node",
          process.env.STORAGE_CUTOVER_TEST_IMAGE, command, ...args],
        { env: workerEnvironment, encoding: "utf8", timeout: 120_000 });
        const backup = runWorker("scripts/backup-worker.mjs", ["--run-once"]);
        assert.equal(backup.status, 0, backup.stderr);
        const [result] = await sql`SELECT status, last_result FROM background_job_status WHERE job_name = 'system.backup'`;
        assert.equal(result.status, "succeeded");
        assert.deepEqual(result.last_result.verifiedFileCounts, completedForward.referenceCounts);
        const restore = runWorker("scripts/backup-restore-check.mjs", ["--verify-only"]);
        assert.equal(restore.status, 0, restore.stderr);
        const restoreResult = JSON.parse(restore.stdout);
        assert.deepEqual(restoreResult.verifiedFileCounts, completedForward.referenceCounts);
      } finally {
        await stopWeb();
        await sql`UPDATE documents SET archived_at = now() WHERE id = ${documentId}`;
        spawnSync("docker", ["volume", "rm", "--force", volume], { stdio: "ignore" });
      }
    });
  }

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
  const localAuditAfterReverse = await auditFiles({ sql, storageRoot,
    onRecord: async () => {} });
  const s3AuditAfterReverse = await auditFiles({ sql, objectStorage: auditStorage,
    onRecord: async () => {} });
  assert.equal(localAuditAfterReverse.verifiedReferences, 6);
  assert.equal(s3AuditAfterReverse.verifiedReferences, 6);
  assert.equal(localAuditAfterReverse.hasFindings, false);
  assert.equal(s3AuditAfterReverse.hasFindings, false);
  assert.equal((await setFileWriteMode({ databaseUrl, mode: "resume" })).accepting, true);
});
