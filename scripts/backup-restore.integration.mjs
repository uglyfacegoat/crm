import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, statfs, symlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { databaseProcessEnvironment } from "./backup-worker-config.mjs";
import { captureProcess, runProcess, sha256File } from "./backup-process.mjs";
import { verifyBackupRestore } from "./backup-restore.mjs";
import { verifyBackupManifest } from "./backup-integrity.mjs";
import { withStorageSnapshot } from "./backup-snapshot.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";

const adminUrl = process.env.BACKUP_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("BACKUP_TEST_ADMIN_URL must point to an isolated disposable PostgreSQL instance.");

test("backup restores the full application schema and validates every retained file reference", async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const databaseName = `crm_backup_test_${randomUUID().replaceAll("-", "")}`;
  const root = await mkdtemp(join(tmpdir(), "crm-backup-restore-test-"));
  let sql;
  let created = false;
  t.after(async () => {
    try {
      if (sql) await sql.end();
      if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
    } finally {
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  });
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  const databaseUrl = url.toString();
  await runMigrations({ databaseUrl, onApplied: () => {} });
  sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Backup test', 'Europe/Moscow') RETURNING id`;
  const organizationId = organization.id;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organizationId}, 'Backup tester', 'backup@example.invalid', 'admin') RETURNING id`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name, primary_phone)
    VALUES (${organizationId}, 'Backup customer', '+70000000000') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organizationId}, ${client.id}, 'Backup object', 'Office', 'Test address') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${organizationId}, ${client.id}, ${object.id}, 'backup-1', 'new', 'RUB',
      'Backup customer', 'Backup object', 'Test address') RETURNING id`;
  const documentId = randomUUID();
  await sql`INSERT INTO documents (id, organization_id, client_id, object_id, order_id, title, category, created_by, archived_at)
    VALUES (${documentId}, ${organizationId}, ${client.id}, ${object.id}, ${order.id}, 'Archived document', 'other', ${member.id}, now())`;
  const templateId = randomUUID();
  await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by)
    VALUES (${templateId}, ${organizationId}, 'Backup template', 'closing_act', ${member.id})`;
  const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, created_by)
    VALUES (${organizationId}, 'Backup channel', 'group', ${member.id}) RETURNING id`;
  const messageId = randomUUID();
  await sql`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body, deleted_at)
    VALUES (${messageId}, ${organizationId}, ${channel.id}, ${member.id}, 'Retained attachment', now())`;

  const storage = join(root, "storage");
  const references = [];
  for (const [table, recordId, version] of [
    ["document_versions", documentId, 1], ["document_versions", documentId, 2],
    ["document_template_versions", templateId, 1],
    ["chat_message_attachments", messageId, 1], ["chat_channel_avatars", channel.id, 1],
  ]) {
    const extension = table === "chat_channel_avatars" ? "png" : "pdf";
    const content = Buffer.from(`${table}: historical file ${version}`);
    const key = `${organizationId}/${recordId}/v${version}.${extension}`;
    const path = join(storage, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    const fields = {
      organization_id: organizationId, storage_key: key, size_bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"), uploaded_by: member.id,
      mime_type: extension === "png" ? "image/png" : "application/pdf",
    };
    if (table === "chat_channel_avatars") Object.assign(fields, { channel_id: recordId });
    else Object.assign(fields, { id: randomUUID(), original_filename: `test.${extension}`, extension });
    if (table === "document_versions") Object.assign(fields, { document_id: recordId, version_number: version });
    if (table === "document_template_versions") Object.assign(fields, { template_id: recordId, version_number: version });
    if (table === "chat_message_attachments") Object.assign(fields, { message_id: recordId });
    await sql`INSERT INTO ${sql(table)} ${sql(fields)}`;
    references.push({ table, path, content });
  }
  const { processEnvironment } = databaseProcessEnvironment(databaseUrl);
  const dump = join(root, "database.dump");
  await runProcess("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dump, databaseName], { environment: processEnvironment });

  async function archive({ dumpPath = dump, storageDirectory = storage } = {}) {
    const name = `20260920T120000Z-${randomBytes(4).toString("hex")}`;
    const directory = join(root, name);
    await mkdir(directory);
    // Copy rather than hard-link: the verifier deliberately rejects linked archive members.
    await copyFile(dumpPath, join(directory, "database.dump"));
    await runProcess("tar", ["-czf", join(directory, "documents.tar.gz"), "-C", storageDirectory, "."]);
    await writeFile(join(directory, "metadata.json"), JSON.stringify({ formatVersion: 1, archiveName: name }));
    const lines = [];
    for (const file of ["database.dump", "documents.tar.gz", "metadata.json"]) {
      lines.push(`${await sha256File(join(directory, file))}  ${file}`);
    }
    await writeFile(join(directory, "manifest.sha256"), `${lines.join("\n")}\n`);
    return directory;
  }

  const restoresBefore = await admin`SELECT datname FROM pg_database WHERE datname LIKE 'crm_restore_check_%' ORDER BY datname`;
  const directoriesBefore = (await readdir(tmpdir())).filter((name) => name.startsWith("crm-documents-restore-")).sort();
  if (process.env.BACKUP_TEST_S3 === "true") await t.test("S3 worker restores all reference families without a local source and fails closed on missing objects", async () => {
    const objectStorage = createS3Storage(process.env);
    const environment = {
      ...process.env, DATABASE_URL: databaseUrl, DOCUMENT_STORAGE_BACKEND: "s3",
      DOCUMENT_STORAGE_ROOT: join(root, "absent-local-source"),
      BACKUP_ROOT: join(root, "s3-backups"), BACKUP_EXPORT_ROOT: join(root, "s3-export"),
    };
    try {
      for (const reference of references) {
        const storageKey = reference.path.slice(storage.length + 1);
        await objectStorage.write(storageKey, reference.content);
      }
      await runProcess(process.execPath, ["scripts/backup-worker.mjs", "--run-once"], { environment });
      const [success] = await sql`SELECT status, last_result FROM background_job_status WHERE job_name = 'system.backup'`;
      assert.equal(success.status, "succeeded");
      assert.deepEqual(success.last_result.verifiedFileCounts, { document_versions: 2, document_template_versions: 1, chat_message_attachments: 1, chat_channel_avatars: 1 });
      assert.ok(success.last_result.restoreDurationMs > 0);
      assert.equal(success.last_result.verifiedFileBytes, references.reduce((total, reference) => total + reference.content.length, 0));
      const exportsBefore = await readdir(environment.BACKUP_EXPORT_ROOT);
      await objectStorage.remove(references[0].path.slice(storage.length + 1));
      environment.DOCUMENT_STORAGE_ROOT = storage;
      await sql`UPDATE background_job_status SET status = 'failed', last_started_at = now() - interval '1 hour' WHERE job_name = 'system.backup'`;
      await assert.rejects(runProcess(process.execPath, ["scripts/backup-worker.mjs", "--run-once"], { environment }), /failed \(1\)/);
      const [failed] = await sql`SELECT status FROM background_job_status WHERE job_name = 'system.backup'`;
      assert.equal(failed.status, "failed");
      assert.deepEqual(await readdir(environment.BACKUP_EXPORT_ROOT), exportsBefore);
      assert.deepEqual(await readFile(references[0].path), references[0].content, "The local source still exists but must not be used as a fallback");
    } finally {
      objectStorage.close();
      await sql`UPDATE background_job_status SET status = 'failed', last_started_at = now() - interval '1 hour' WHERE job_name = 'system.backup'`;
    }
  });
  await t.test("snapshot includes a writer it waited for, then survives live avatar replacement and deletion", async () => {
    const writer = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const locked = Promise.withResolvers();
    const release = Promise.withResolvers();
    const avatar = references.find((reference) => reference.table === "chat_channel_avatars");
    const newKey = `${organizationId}/${channel.id}/v2.png`;
    const newPath = join(storage, newKey);
    const newContent = Buffer.from("Replacement avatar after snapshot");
    const newHash = createHash("sha256").update(newContent).digest("hex");
    const orphan = join(storage, organizationId, randomUUID(), "v1.pdf");
    await mkdir(dirname(orphan));
    await writeFile(orphan, "Uncommitted or orphaned file must not enter backup");
    const transaction = writer.begin(async (connection) => {
      await connection`LOCK TABLE chat_channel_avatars IN ROW EXCLUSIVE MODE`;
      await connection`UPDATE clients SET legal_name = 'Committed while backup waited' WHERE id = ${client.id}`;
      locked.resolve();
      await release.promise;
    });
    transaction.catch(locked.reject);
    let backup;
    try {
      await locked.promise;
      const stagingDirectory = join(root, "snapshot-staging");
      const snapshotDump = join(root, "snapshot.dump");
      backup = withStorageSnapshot({ databaseUrl, storageRoot: storage, stagingDirectory, copyTimeoutMs: 30_000 }, async (snapshot) => {
        const [locks] = await admin`SELECT count(*)::integer AS count FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
          WHERE a.datname = ${databaseName} AND a.application_name = 'crm_backup_snapshot' AND l.mode = 'ShareLock' AND l.granted`;
        assert.equal(locks.count, 0, "File-reference locks must be released before database dump");
        await writeFile(newPath, newContent);
        await sql`UPDATE chat_channel_avatars SET storage_key = ${newKey}, size_bytes = ${newContent.length}, sha256 = ${newHash} WHERE channel_id = ${channel.id}`;
        await rm(avatar.path);
        await sql`UPDATE clients SET legal_name = 'Changed after snapshot' WHERE id = ${client.id}`;
        await runProcess("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot.snapshotId}`, "--file", snapshotDump, databaseName], { environment: processEnvironment });
        const restoredClients = await captureProcess("pg_restore", ["--data-only", "--table=clients", "--file=-", snapshotDump]);
        assert.match(restoredClients, /Committed while backup waited/);
        assert.doesNotMatch(restoredClients, /Changed after snapshot/);
        assert.deepEqual(await readFile(join(stagingDirectory, organizationId, channel.id, "v1.png")), avatar.content);
        await assert.rejects(readFile(join(stagingDirectory, newKey)), { code: "ENOENT" });
        await assert.rejects(readFile(join(stagingDirectory, organizationId, orphan.split("/").at(-2), "v1.pdf")), { code: "ENOENT" });
        assert.equal(snapshot.snapshotFileBytes, references.reduce((total, reference) => total + reference.content.length, 0));
        const result = await verifyBackupRestore({ archiveDirectory: await archive({ dumpPath: snapshotDump, storageDirectory: stagingDirectory }), databaseUrl });
        assert.deepEqual(result.verifiedFileCounts, snapshot.snapshotFileCounts);
        assert.equal(result.verifiedFileBytes, snapshot.snapshotFileBytes);
      });
      // Observe the actual lock wait instead of assuming a delay means the backup has started.
      backup.catch(() => {}); // Awaited below; prevent an unhandled rejection while observing locks.
      const deadline = performance.now() + 4000;
      let waiting = false;
      while (performance.now() < deadline) {
        const [state] = await admin`SELECT count(*)::integer AS count FROM pg_stat_activity
          WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot' AND wait_event_type = 'Lock'`;
        if (state.count) { waiting = true; break; }
        await delay(10);
      }
      assert.ok(waiting, "Backup must wait for the live file-reference writer");
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_channel_avatars`)[0].count, 1, "Reads must remain available during snapshot lock acquisition");
      await sql`UPDATE organizations SET name = 'Unrelated write during backup' WHERE id = ${organizationId}`;
      release.resolve();
      await transaction;
      await backup;
    } finally {
      release.resolve();
      await Promise.allSettled([transaction, backup]);
      await writer.end();
      await writeFile(avatar.path, avatar.content);
      await sql`UPDATE chat_channel_avatars SET storage_key = ${`${organizationId}/${channel.id}/v1.png`}, size_bytes = ${avatar.content.length}, sha256 = ${createHash("sha256").update(avatar.content).digest("hex")} WHERE channel_id = ${channel.id}`;
      await rm(newPath, { force: true });
      await rm(dirname(orphan), { recursive: true });
    }
  });
  await t.test("dump failure releases snapshot connections and does not block later file writes", async () => {
    await assert.rejects(withStorageSnapshot({ databaseUrl, storageRoot: storage, stagingDirectory: join(root, "failed-snapshot"), copyTimeoutMs: 30_000 }, async () => {
      throw new Error("Injected dump failure");
    }), /Injected dump failure/);
    assert.equal((await admin`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot'`)[0].count, 0);
    await sql.begin(async (connection) => {
      await connection`SET LOCAL lock_timeout = '1s'`;
      await connection`UPDATE chat_channel_avatars SET sha256 = sha256 WHERE channel_id = ${channel.id}`;
    });
  });
  await t.test("missing source file fails staging and releases both snapshot sessions", async () => {
    const reference = references[0];
    await rm(reference.path);
    try {
      let dumped = false;
      await assert.rejects(withStorageSnapshot({ databaseUrl, storageRoot: storage, stagingDirectory: join(root, "missing-file-snapshot"), copyTimeoutMs: 30_000 }, async () => { dumped = true; }), { code: "ENOENT" });
      assert.equal(dumped, false);
      assert.equal((await admin`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot'`)[0].count, 0);
    } finally {
      await writeFile(reference.path, reference.content);
    }
  });
  await t.test("full S3 staging disk leaves no partial file and a later snapshot succeeds", async () => {
    const stagingDirectory = join(root, "full-s3-staging");
    const objectStorage = {
      async readVerified(key) { return readFile(join(storage, key)); },
    };
    let dumped = false;
    let partialPath;
    await assert.rejects(withStorageSnapshot({
      databaseUrl, storageRoot: join(root, "absent-local-source"), objectStorage,
      stagingDirectory, copyTimeoutMs: 30_000,
      async stageObject(path, bytes, options) {
        partialPath = path;
        await writeFile(path, bytes.subarray(0, 1), options);
        const error = new Error("Injected staging disk full");
        error.code = "ENOSPC";
        throw error;
      },
    }, async () => { dumped = true; }), { code: "ENOSPC" });
    assert.equal(dumped, false, "A failed staging copy must not start pg_dump");
    await assert.rejects(readFile(partialPath), { code: "ENOENT" });
    assert.equal((await admin`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot'`)[0].count, 0);
    await rm(stagingDirectory, { recursive: true, force: true });
    const result = await withStorageSnapshot({
      databaseUrl, storageRoot: join(root, "absent-local-source"), objectStorage,
      stagingDirectory, copyTimeoutMs: 30_000,
    }, async (snapshot) => snapshot);
    assert.deepEqual(result.snapshotFileCounts, { document_versions: 2, document_template_versions: 1, chat_message_attachments: 1, chat_channel_avatars: 1 });
    assert.equal(result.snapshotFileBytes, references.reduce((total, reference) => total + reference.content.length, 0));
    assert.deepEqual(await readFile(partialPath), references.find(reference => reference.path === join(storage, partialPath.slice(stagingDirectory.length + 1))).content);
  });
  if (process.env.BACKUP_TEST_FULL_STAGE_ROOT) await t.test("real full staging volume rejects backup and recovers after space is freed", async () => {
    const stageRoot = process.env.BACKUP_TEST_FULL_STAGE_ROOT;
    const stagingDirectory = join(stageRoot, `snapshot-${randomUUID()}`);
    const filler = join(stageRoot, `filler-${randomUUID()}`);
    let attemptedPath;
    let dumped = false;
    const objectStorage = {
      async readVerified(key) {
        attemptedPath = join(stagingDirectory, key);
        const { bavail, bsize } = await statfs(stageRoot);
        assert.ok(bavail * bsize > 0 && bavail * bsize < 4 * 1024 * 1024, "Use an isolated small tmpfs for this test");
        try { await writeFile(filler, Buffer.alloc(bavail * bsize)); }
        catch (error) { if (error.code !== "ENOSPC") throw error; }
        assert.equal((await statfs(stageRoot)).bavail, 0, "The staging volume must actually be full");
        return readFile(join(storage, key));
      },
    };
    try {
      await assert.rejects(withStorageSnapshot({
        databaseUrl, storageRoot: join(root, "absent-local-source"), objectStorage,
        stagingDirectory, copyTimeoutMs: 30_000,
      }, async () => { dumped = true; }), { code: "ENOSPC" });
      assert.equal(dumped, false);
      await assert.rejects(readFile(attemptedPath), { code: "ENOENT" });
      assert.equal((await admin`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot'`)[0].count, 0);
    } finally {
      await rm(filler, { force: true });
      await rm(stagingDirectory, { recursive: true, force: true });
    }
    const recovered = await withStorageSnapshot({
      databaseUrl, storageRoot: join(root, "absent-local-source"),
      objectStorage: { readVerified: key => readFile(join(storage, key)) },
      stagingDirectory, copyTimeoutMs: 30_000,
    }, async snapshot => snapshot);
    assert.equal(recovered.snapshotFileBytes, references.reduce((total, reference) => total + reference.content.length, 0));
    await rm(stagingDirectory, { recursive: true, force: true });
  });
  await t.test("contended file table fails within the lock budget without leaving a snapshot session", async () => {
    const writer = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    try {
      await writer.begin(async (connection) => {
        await connection`LOCK TABLE document_versions IN ROW EXCLUSIVE MODE`;
        await assert.rejects(withStorageSnapshot({ databaseUrl, storageRoot: storage, stagingDirectory: join(root, "contended-snapshot"), copyTimeoutMs: 30_000 }, async () => {
          assert.fail("A failed lock acquisition must not start a dump");
        }), { code: "55P03" });
        assert.equal((await admin`SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = ${databaseName} AND application_name = 'crm_backup_snapshot'`)[0].count, 0);
      });
    } finally {
      await writer.end();
    }
  });
  await t.test("successful restore reports all historical file counts, bytes and measured duration", async () => {
    const result = await verifyBackupRestore({ archiveDirectory: await archive(), databaseUrl });
    assert.deepEqual(result.verifiedFileCounts, { document_versions: 2, document_template_versions: 1, chat_message_attachments: 1, chat_channel_avatars: 1 });
    assert.equal(result.verifiedFileBytes, references.reduce((total, reference) => total + reference.content.length, 0));
    assert.equal(result.migrationCount, (await sql`SELECT count(*)::integer AS count FROM schema_migrations`)[0].count);
    assert.ok(result.restoreDurationMs > 0);
    t.diagnostic(`Fixture restore including checksum verification and cleanup: ${result.restoreDurationMs} ms`);
  });
  for (const reference of references) {
    for (const failure of ["missing", "changed bytes"]) {
      await t.test(`${reference.table} ${failure} fails even with a valid archive manifest`, async () => {
        try {
          if (failure === "missing") await rm(reference.path);
          else await writeFile(reference.path, Buffer.alloc(reference.content.length));
          await assert.rejects(verifyBackupRestore({ archiveDirectory: await archive(), databaseUrl }), (error) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.some((cause) => failure === "missing" ? cause.code === "ENOENT" : /checksum/.test(cause.message)));
            return true;
          });
        } finally {
          await writeFile(reference.path, reference.content);
        }
      });
    }
  }
  for (const makeLink of [symlink, link]) {
    await t.test(`real tar archive containing ${makeLink.name} is rejected before extraction`, async () => {
      const path = join(storage, organizationId, randomUUID(), "v1.pdf");
      await mkdir(dirname(path));
      try {
        await makeLink(references[0].path, path);
        await assert.rejects(verifyBackupRestore({ archiveDirectory: await archive(), databaseUrl }), /link or unsupported/);
      } finally {
        await rm(dirname(path), { recursive: true });
      }
    });
  }
  await t.test("worker records verified file totals and exits nonzero when the next restore fails", async () => {
    const backupRoot = join(root, "worker-backups");
    const exportRoot = join(root, "worker-export");
    const environment = {
      ...process.env, DATABASE_URL: databaseUrl, DOCUMENT_STORAGE_BACKEND: "local", DOCUMENT_STORAGE_ROOT: storage,
      BACKUP_ROOT: backupRoot, BACKUP_EXPORT_ROOT: exportRoot,
    };
    await runProcess(process.execPath, ["scripts/backup-worker.mjs", "--run-once"], { environment });
    const [success] = await sql`SELECT status, last_result FROM background_job_status WHERE job_name = 'system.backup'`;
    assert.equal(success.status, "succeeded");
    assert.equal(success.last_result.verifiedFileCounts.document_versions, 2);
    assert.ok(success.last_result.restoreDurationMs > 0);
    assert.ok(Number.isFinite(Date.parse(success.last_result.recoveryPointAt)));
    assert.ok(success.last_result.fileLockDurationMs >= 0);
    const metadata = JSON.parse(await readFile(join(backupRoot, success.last_result.archiveName, "metadata.json"), "utf8"));
    assert.equal(metadata.formatVersion, 2);
    assert.equal(metadata.consistency, "postgres-exported-snapshot");
    assert.deepEqual(metadata.snapshotFileCounts, success.last_result.verifiedFileCounts);
    assert.equal(metadata.snapshotFileBytes, success.last_result.verifiedFileBytes);
    const [run] = await sql`SELECT status, restore_verified_at FROM backup_runs WHERE archive_name = ${success.last_result.archiveName}`;
    assert.equal(run.status, "succeeded");
    assert.ok(run.restore_verified_at);
    const exportedBefore = await readdir(exportRoot);
    assert.deepEqual(exportedBefore, [success.last_result.archiveName]);
    const exportedDirectory = join(exportRoot, success.last_result.archiveName);
    await verifyBackupManifest(exportedDirectory);
    assert.deepEqual(await readFile(join(exportedDirectory, "manifest.sha256")),
      await readFile(join(backupRoot, success.last_result.archiveName, "manifest.sha256")));
    await sql`UPDATE background_job_status SET status = 'failed', last_started_at = now() - interval '1 hour' WHERE job_name = 'system.backup'`;
    try {
      await rm(references[0].path);
      await assert.rejects(runProcess(process.execPath, ["scripts/backup-worker.mjs", "--run-once"], { environment }), /failed \(1\)/);
      const [failed] = await sql`SELECT status FROM background_job_status WHERE job_name = 'system.backup'`;
      assert.equal(failed.status, "failed");
      const [failedRun] = await sql`SELECT status, restore_verified_at FROM backup_runs ORDER BY started_at DESC LIMIT 1`;
      assert.equal(failedRun.status, "failed");
      assert.equal(failedRun.restore_verified_at, null);
      assert.deepEqual(await readdir(exportRoot), exportedBefore, "A failed restore must not be exported");
    } finally {
      await writeFile(references[0].path, references[0].content);
    }
    const expiredArchive = join(backupRoot, "20000101T000000Z-deadbeef");
    await mkdir(expiredArchive);
    await writeFile(join(expiredArchive, "protected"), "test retention failure");
    await chmod(expiredArchive, 0o000);
    try {
      await sql`UPDATE background_job_status SET last_started_at = now() - interval '1 hour' WHERE job_name = 'system.backup'`;
      await assert.rejects(runProcess(process.execPath, ["scripts/backup-worker.mjs", "--run-once"], { environment }), /failed \(1\)/);
      assert.equal((await sql`SELECT status FROM backup_runs ORDER BY started_at DESC LIMIT 1`)[0].status, "failed");
      assert.equal((await sql`SELECT status FROM background_job_status WHERE job_name = 'system.backup'`)[0].status, "failed");
    } finally {
      await chmod(expiredArchive, 0o700);
      await rm(expiredArchive, { recursive: true });
    }
    const output = await captureProcess(process.execPath, ["scripts/backup-restore-check.mjs", `--archive=${success.last_result.archiveName}`], { environment });
    assert.equal(JSON.parse(output).verifiedFileCounts.chat_channel_avatars, 1);
    const verifiedBefore = await sql`SELECT restore_verified_at FROM backup_runs WHERE archive_name = ${success.last_result.archiveName}`;
    const independentOutput = await captureProcess(process.execPath, ["scripts/backup-restore-check.mjs", "--verify-only", `--archive=${success.last_result.archiveName}`], {
      environment: { ...environment, DATABASE_URL: adminUrl },
    });
    assert.equal(JSON.parse(independentOutput).verifiedFileCounts.document_versions, 2);
    assert.deepEqual(await sql`SELECT restore_verified_at FROM backup_runs WHERE archive_name = ${success.last_result.archiveName}`, verifiedBefore);
  });
  assert.deepEqual(await admin`SELECT datname FROM pg_database WHERE datname LIKE 'crm_restore_check_%' ORDER BY datname`, restoresBefore);
  assert.deepEqual((await readdir(tmpdir())).filter((name) => name.startsWith("crm-documents-restore-")).sort(), directoriesBefore);
});
