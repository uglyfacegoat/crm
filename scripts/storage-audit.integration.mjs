import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import postgres from "postgres";
import { auditStorage } from "./storage-audit.mjs";
import { createS3AuditStorage } from "./s3-audit-storage.mjs";
import { DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand, PutBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must point to isolated PostgreSQL.");

test("storage audit diagnoses all retained files without modifying storage or records", { timeout: 180_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_storage_audit_${randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "crm-storage-audit-"));
  const storageRoot = join(directory, "storage");
  await mkdir(storageRoot);
  let sql;
  let created = false;
  t.after(async () => {
    await sql?.end();
    try { if (created) await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
  });
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  await runMigrations({ databaseUrl, onApplied: () => {} });
  sql = postgres(databaseUrl, { max: 2, onnotice: () => {} });
  const [organization] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Audit fixture', 'Europe/Moscow') RETURNING id`;
  const organizationId = organization.id;
  const [member] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${organizationId}, 'Audit tester', 'audit@example.invalid', 'admin') RETURNING id`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${organizationId}, 'Audit customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${organizationId}, ${client.id}, 'Audit object', 'Office', 'Test address') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${organizationId}, ${client.id}, ${object.id}, 'audit-1', 'new', 'RUB', 'Audit customer', 'Audit object', 'Test address') RETURNING id`;
  const documentId = randomUUID();
  await sql`INSERT INTO documents (id, organization_id, client_id, object_id, order_id, title, category, created_by, archived_at)
    VALUES (${documentId}, ${organizationId}, ${client.id}, ${object.id}, ${order.id}, 'Archived document', 'other', ${member.id}, now())`;
  const templateId = randomUUID();
  await sql`INSERT INTO document_templates (id, organization_id, title, template_kind, created_by, active)
    VALUES (${templateId}, ${organizationId}, 'Inactive template', 'closing_act', ${member.id}, false)`;
  const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, created_by)
    VALUES (${organizationId}, 'Audit channel', 'group', ${member.id}) RETURNING id`;
  const messageId = randomUUID();
  await sql`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body, deleted_at)
    VALUES (${messageId}, ${organizationId}, ${channel.id}, ${member.id}, 'Deleted message', now())`;
  const references = [];
  for (const [table, recordId, version] of [
    ["document_versions", documentId, 1], ["document_versions", documentId, 2],
    ["document_template_versions", templateId, 1], ["chat_message_attachments", messageId, 1],
    ["chat_channel_avatars", channel.id, 1],
  ]) {
    const extension = table === "chat_channel_avatars" ? "png" : "pdf";
    const content = Buffer.from(`${table} version ${version}`);
    const storageKey = `${organizationId}/${recordId}/v${version}.${extension}`;
    const path = join(storageRoot, storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    const fields = { organization_id: organizationId, storage_key: storageKey, size_bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"), uploaded_by: member.id,
      mime_type: extension === "png" ? "image/png" : "application/pdf" };
    if (table === "chat_channel_avatars") Object.assign(fields, { channel_id: recordId });
    else Object.assign(fields, { id: randomUUID(), original_filename: `fixture.${extension}`, extension });
    if (table === "document_versions") Object.assign(fields, { document_id: recordId, version_number: version });
    if (table === "document_template_versions") Object.assign(fields, { template_id: recordId, version_number: version });
    if (table === "chat_message_attachments") Object.assign(fields, { message_id: recordId });
    await sql`INSERT INTO ${sql(table)} ${sql(fields)}`;
    references.push({ table, path, content, fields });
  }
  const capture = async (onRecord = () => {}) => {
    const records = [];
    const summary = await auditStorage({ sql, storageRoot, onRecord: async (record) => { records.push(record); await onRecord(record); } });
    return { records, summary };
  };
  const cli = (args = ["--check"], env = {}) => spawnSync(process.execPath, ["scripts/storage-audit.mjs", ...args], {
    env: { ...process.env, DOCUMENT_STORAGE_BACKEND: "local", DATABASE_URL: databaseUrl, DOCUMENT_STORAGE_ROOT: storageRoot, ...env }, encoding: "utf8", timeout: 15_000,
  });

  await t.test("clean inventory includes old versions, inactive templates and deleted-message attachments", async () => {
    const { records, summary } = await capture();
    assert.equal(records.length, 2);
    assert.equal(summary.hasFindings, false);
    assert.equal(summary.verifiedReferences, 5);
    assert.equal(summary.scannedFiles, 5);
    assert.equal(summary.scannedBytes, references.reduce((total, reference) => total + reference.content.length, 0));
    assert.deepEqual(summary.referenceCounts, { document_versions: 2, document_template_versions: 1, chat_message_attachments: 1, chat_channel_avatars: 1 });
    assert.equal(cli().status, 0);
  });

  await t.test("multiple batches of old unreferenced files are reported, never removed", async () => {
    const paths = [];
    try {
      for (let index = 0; index < 105; index += 1) {
        const path = join(storageRoot, organizationId, randomUUID(), "v1.pdf");
        await mkdir(dirname(path)); await writeFile(path, "unconfirmed");
        await utimes(path, new Date(0), new Date(0)); paths.push(path);
      }
      const { records, summary } = await capture();
      assert.equal(summary.unreferencedFiles, 105);
      assert.equal(summary.scannedFiles, 110);
      assert.equal(summary.verifiedReferences, 5);
      assert.equal(records.filter((record) => record.event === "storage.audit.unreferenced_in_snapshot" && record.safeToDelete === false).length, 105);
      assert.equal(cli().status, 2);
      for (const path of paths) assert.equal(await readFile(path, "utf8"), "unconfirmed");
    } finally { for (const path of paths) await rm(dirname(path), { recursive: true }); }
  });

  for (const reference of references) {
    await t.test(`missing ${reference.table} version ${reference.fields.version_number ?? 1} is an explicit finding`, async () => {
      await rm(reference.path);
      try {
        const { records, summary } = await capture();
        assert.equal(summary.integrityFailures, 1);
        assert.ok(records.some((record) => record.storageKey === reference.fields.storage_key && record.reason === "missing"));
        assert.equal(cli().status, 2);
      } finally { await writeFile(reference.path, reference.content); }
    });
  }

  await t.test("same-size corruption is detected without changing stored bytes", async () => {
    const reference = references[0];
    const corrupted = Buffer.alloc(reference.content.length, 120);
    await writeFile(reference.path, corrupted);
    try {
      assert.equal((await capture()).summary.integrityFailures, 1);
      assert.deepEqual(await readFile(reference.path), corrupted);
    } finally { await writeFile(reference.path, reference.content); }
  });

  await t.test("links and unexpected directories are reported without traversing them", async () => {
    const outside = join(directory, "outside");
    await mkdir(outside); await writeFile(join(outside, "private.txt"), "must not be scanned");
    const linkedDirectory = join(storageRoot, randomUUID());
    const linkedFile = join(storageRoot, organizationId, documentId, "v3.pdf");
    await symlink(outside, linkedDirectory);
    await link(references[0].path, linkedFile);
    try {
      const { records, summary } = await capture();
      assert.equal(summary.unexpectedEntries, 3);
      assert.equal(summary.integrityFailures, 1);
      assert.ok(!JSON.stringify(records).includes("private.txt"));
      assert.equal(await readFile(join(outside, "private.txt"), "utf8"), "must not be scanned");
      await assert.rejects(auditStorage({ sql, storageRoot: linkedDirectory, onRecord: () => {} }), /real directory/);
    } finally { await rm(linkedDirectory); await rm(linkedFile); }
  });

  await t.test("a reference committed after snapshot is not misrepresented as safe to delete", async () => {
    const reference = references[0];
    const fields = { ...reference.fields, id: randomUUID(), version_number: 3,
      storage_key: `${organizationId}/${documentId}/v3.pdf` };
    const path = join(storageRoot, fields.storage_key);
    await writeFile(path, reference.content);
    try {
      const { records, summary } = await capture(async (record) => {
        if (record.event === "storage.audit.started") await sql`INSERT INTO document_versions ${sql(fields)}`;
      });
      assert.equal(summary.unreferencedFiles, 1);
      assert.ok(records.some((record) => record.storageKey === fields.storage_key && record.safeToDelete === false));
      assert.deepEqual(await readFile(path), reference.content);
      assert.equal((await capture()).summary.unreferencedFiles, 0);
    } finally { await sql`DELETE FROM document_versions WHERE id = ${fields.id}`; await rm(path); }
  });

  await t.test("failed output aborts the report and releases the transaction", async () => {
    await assert.rejects(capture(() => { throw new Error("Report sink failed"); }), /Report sink failed/);
    assert.equal((await capture()).summary.hasFindings, false);
  });

  await t.test("CLI rejects mutation flags and fails closed when its schema is unavailable", () => {
    for (const args of [[], ["--delete"], ["--check", "--delete"]]) assert.equal(cli(args).status, 1);
    const failed = cli(["--check"], { DATABASE_URL: adminUrl });
    assert.equal(failed.status, 1);
    assert.doesNotMatch(failed.stdout, /storage.audit.complete/);
    assert.doesNotMatch(failed.stderr, /postgres:\/\//);
  });

  if (process.env.STORAGE_AUDIT_TEST_S3 === "true") await t.test("S3 inventory includes object versions and deletion markers without modifying them", async (s3Test) => {
    const { startS3Fixture } = await import("./fixtures/s3-server.mjs");
    const fixture = await startS3Fixture();
    const objectStorage = createS3AuditStorage(fixture.environment);
    s3Test.after(async () => { objectStorage.close(); await fixture.close(); });
    const put = (key, content) => fixture.client.send(new PutObjectCommand({ Bucket: fixture.bucket, Key: key, Body: content }));
    const remove = (key, versionId) => fixture.client.send(new DeleteObjectCommand({ Bucket: fixture.bucket, Key: key, VersionId: versionId }));
    const captureS3 = async (onRecord = () => {}, storage = objectStorage) => {
      const records = [];
      const summary = await auditStorage({ sql, objectStorage: storage, onRecord: async (record) => { records.push(record); await onRecord(record); } });
      return { records, summary };
    };
    for (const reference of references) await put(reference.fields.storage_key, reference.content);

    await s3Test.test("unversioned bucket checks all four retained families with no local storage directory", async () => {
      const { summary } = await captureS3();
      assert.equal(summary.bucketVersioning, "Disabled");
      assert.equal(summary.verifiedReferences, 5);
      assert.equal(summary.scannedVersions, 5);
      assert.equal(summary.scannedFiles, 5);
      assert.equal(summary.scannedBytes, references.reduce((total, reference) => total + reference.content.length, 0));
      assert.deepEqual(summary.referenceCounts, { document_versions: 2, document_template_versions: 1, chat_message_attachments: 1, chat_channel_avatars: 1 });
      assert.equal(summary.hasFindings, false);
      const result = cli(["--check"], { ...fixture.environment, DOCUMENT_STORAGE_ROOT: "" });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout.trim().split("\n").at(-1)).verifiedReferences === 5);
    });

    await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket, VersioningConfiguration: { Status: "Enabled" } }));
    await s3Test.test("a valid old version cannot hide corruption of the current version", async () => {
      const reference = references[0];
      const corrupt = await put(reference.fields.storage_key, Buffer.alloc(reference.content.length, 120));
      try {
        const before = await fixture.client.send(new ListObjectVersionsCommand({ Bucket: fixture.bucket }));
        const { records, summary } = await captureS3();
        assert.equal(summary.integrityFailures, 1);
        assert.equal(summary.scannedVersions, 6);
        assert.equal(summary.noncurrentVersions, 1);
        assert.ok(records.some(record => record.event === "storage.audit.noncurrent_version" && record.referencedInSnapshot && !record.safeToDelete));
        const after = await fixture.client.send(new ListObjectVersionsCommand({ Bucket: fixture.bucket }));
        assert.deepEqual(after.Versions, before.Versions, "Audit must not delete or replace versions");
        assert.equal(cli(["--check"], fixture.environment).status, 2);
      } finally { await remove(reference.fields.storage_key, corrupt.VersionId); }
    });

    for (const reference of references) await s3Test.test(`delete marker on ${reference.table} is missing, not recovered silently from disk or an old version`, async () => {
      const marker = await remove(reference.fields.storage_key);
      try {
        const { records, summary } = await captureS3();
        assert.equal(summary.integrityFailures, 1);
        assert.equal(summary.scannedFiles, 4);
        assert.equal(summary.currentDeleteMarkers, 1);
        assert.ok(records.some(record => record.event === "storage.audit.reference_invalid" && record.reason === "missing"));
        assert.ok(records.some(record => record.event === "storage.audit.delete_marker" && record.versionId === marker.VersionId && record.referencedInSnapshot));
        assert.equal(cli(["--check"], fixture.environment).status, 2, "Existing local bytes must not conceal a missing S3 object");
        assert.deepEqual(await readFile(reference.path), reference.content);
      } finally { await remove(reference.fields.storage_key, marker.VersionId); }
    });

    await s3Test.test("pagination retains every version of one key and counts unrelated objects and markers", async () => {
      const orphanKey = `${organizationId}/${randomUUID()}/v1.pdf`;
      const created = [];
      try {
        for (let index = 0; index < 105; index += 1) created.push(await put(orphanKey, `unconfirmed ${index}`));
        const marker = await remove(orphanKey);
        created.push(marker);
        const latest = await put(orphanKey, "latest unconfirmed");
        created.push(latest);
        const { records, summary } = await captureS3();
        assert.equal(summary.scannedVersions, 111);
        assert.equal(summary.scannedFiles, 6);
        assert.equal(summary.noncurrentVersions, 105);
        assert.equal(summary.unreferencedVersions, 106);
        assert.equal(summary.unreferencedFiles, 1);
        assert.equal(summary.deleteMarkers, 1);
        assert.equal(summary.currentDeleteMarkers, 0);
        const orphanRecords = records.filter(record => record.storageKey === orphanKey);
        assert.equal(orphanRecords.length, 107);
        assert.ok(orphanRecords.every(record => record.safeToDelete === false));
        const response = await fixture.client.send(new GetObjectCommand({ Bucket: fixture.bucket, Key: orphanKey, VersionId: created[0].VersionId }));
        assert.equal(await response.Body.transformToString(), "unconfirmed 0");
      } finally { for (const version of created) await remove(orphanKey, version.VersionId); }
    });

    await s3Test.test("unexpected percent-encoded names are fingerprinted, never printed or deleted", async () => {
      const key = "secret address/личные+%2Fданные.txt";
      const version = await put(key, "must remain");
      try {
        const { records, summary } = await captureS3();
        assert.equal(summary.unexpectedEntries, 1);
        assert.ok(records.some(record => record.keyHash === createHash("sha256").update(key).digest("hex")));
        assert.doesNotMatch(JSON.stringify(records), /secret address|личные|данные/);
        const response = await fixture.client.send(new GetObjectCommand({ Bucket: fixture.bucket, Key: key }));
        assert.equal(await response.Body.transformToString(), "must remain");
      } finally { await remove(key, version.VersionId); }
    });

    await s3Test.test("suspended versioning still includes retained versions and the null version", async () => {
      await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket, VersioningConfiguration: { Status: "Suspended" } }));
      const reference = references[0];
      await put(reference.fields.storage_key, reference.content);
      const { summary } = await captureS3();
      assert.equal(summary.bucketVersioning, "Suspended");
      assert.equal(summary.verifiedReferences, 5);
      assert.equal(summary.hasFindings, false);
      await fixture.client.send(new PutBucketVersioningCommand({ Bucket: fixture.bucket, VersioningConfiguration: { Status: "Enabled" } }));
    });

    await s3Test.test("snapshot races never authorize cleanup of a newly committed reference", async () => {
      const reference = references[0];
      const fields = { ...reference.fields, id: randomUUID(), version_number: 3, storage_key: `${organizationId}/${documentId}/v3.pdf` };
      const version = await put(fields.storage_key, reference.content);
      try {
        const { records, summary } = await captureS3(async (record) => {
          if (record.event === "storage.audit.started") await sql`INSERT INTO document_versions ${sql(fields)}`;
        });
        assert.equal(summary.unreferencedFiles, 1);
        assert.ok(records.some(record => record.storageKey === fields.storage_key && record.safeToDelete === false));
        assert.equal((await captureS3()).summary.unreferencedFiles, 0);
      } finally { await sql`DELETE FROM document_versions WHERE id = ${fields.id}`; await remove(fields.storage_key, version.VersionId); }
    });

    await s3Test.test("permission, configuration, pagination and output failures cannot report a complete inventory", async () => {
      const failed = cli(["--check"], { ...fixture.environment, DOCUMENT_S3_SECRET_ACCESS_KEY: "invalid-fixture-secret" });
      assert.equal(failed.status, 1);
      assert.doesNotMatch(failed.stdout, /storage.audit.complete/);
      assert.doesNotMatch(failed.stderr, /invalid-fixture-secret|127\.0\.0\.1|postgres:\/\//);
      for (const args of [[], ["--delete"], ["--check", "--delete"]]) assert.equal(cli(args, fixture.environment).status, 1);
      const failedRecords = [];
      await assert.rejects(captureS3(record => failedRecords.push(record), {
        ...objectStorage,
        async *inventory() { yield* objectStorage.inventory(); throw new Error("Later page unavailable"); },
      }), /Later page unavailable/);
      assert.ok(!failedRecords.some(record => record.event === "storage.audit.complete"));
      await assert.rejects(captureS3(() => { throw new Error("Report sink failed"); }), /Report sink failed/);
      let versioningReads = 0;
      await assert.rejects(captureS3(() => {}, {
        ...objectStorage, versioning: async () => ++versioningReads === 1 ? "Enabled" : "Suspended",
      }), /versioning changed/);
      assert.equal((await captureS3()).summary.hasFindings, false);
    });

    if (process.env.S3_AUDIT_TEST_IMAGE) await s3Test.test("packaged runtime CLI reports success, findings and permission failure without local files", async () => {
      const databaseAddress = new URL(databaseUrl);
      if (["localhost", "127.0.0.1"].includes(databaseAddress.hostname)) databaseAddress.hostname = "host.docker.internal";
      const environment = {
        ...process.env, ...fixture.environment,
        DATABASE_URL: databaseAddress.toString(), DOCUMENT_STORAGE_ROOT: "",
        DOCUMENT_S3_ENDPOINT: "http://127.0.0.1:9000",
      };
      const keys = [...Object.keys(fixture.environment), "DATABASE_URL", "DOCUMENT_STORAGE_ROOT"];
      const packaged = (overrides = {}) => spawnSync("docker", [
        "run", "--rm", "--network", `container:${fixture.containerName}`,
        ...keys.flatMap(key => ["--env", key]), "--entrypoint", "node", process.env.S3_AUDIT_TEST_IMAGE,
        "scripts/storage-audit.mjs", "--check",
      ], { env: { ...environment, ...overrides }, encoding: "utf8", timeout: 30_000 });
      const healthy = packaged();
      assert.equal(healthy.status, 0, healthy.stderr);
      const summary = JSON.parse(healthy.stdout.trim().split("\n").at(-1));
      assert.equal(summary.backend, "s3");
      assert.equal(summary.verifiedReferences, 5);
      assert.equal(summary.scannedFiles, 5);
      assert.equal(summary.safeToDelete, false);
      const reference = references[0];
      const marker = await remove(reference.fields.storage_key);
      try {
        const missing = packaged();
        assert.equal(missing.status, 2, missing.stderr);
        assert.equal(JSON.parse(missing.stdout.trim().split("\n").at(-1)).integrityFailures, 1);
        assert.match(missing.stdout, /storage.audit.delete_marker/);
      } finally { await remove(reference.fields.storage_key, marker.VersionId); }
      const denied = packaged({ DOCUMENT_S3_SECRET_ACCESS_KEY: "invalid-fixture-secret" });
      assert.equal(denied.status, 1);
      assert.doesNotMatch(denied.stdout, /storage.audit.complete/);
      assert.doesNotMatch(denied.stderr, /invalid-fixture-secret|postgres:\/\//);
    });
  });
});
