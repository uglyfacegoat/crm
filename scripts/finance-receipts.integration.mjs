import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { runMigrations } from "./migrate.mjs";
import { startCommitLossProxy } from "./fixtures/postgres-commit-proxy.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl) throw new Error("MIGRATION_TEST_ADMIN_URL must identify an isolated test PostgreSQL instance.");
const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href)) {
      if (specifier === "next/cache") return nextResolve("next/cache.js", context);
      if (specifier.startsWith("@/")) return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
      if (specifier.startsWith(".") && !/\.(ts|mjs)$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
let sql;
let sessionMember;
const revalidatePath = mock.fn();
mock.module("server-only", { namedExports: {} });
mock.module("next/cache.js", { namedExports: { revalidatePath } });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => sql } });
mock.module(new URL("server/auth/config.ts", sourceRoot), { namedExports: { getAuthMode: () => "required" } });
mock.module(new URL("server/auth/session.ts", sourceRoot), { namedExports: { requireSession: async () => sessionMember } });
const finance = await import("../src/server/finance/repository.ts");
const actions = await import("../src/app/(workspace)/finance/actions.ts");
const documentActions = await import("../src/app/(workspace)/documents/actions.ts");
const visitActions = await import("../src/app/(workspace)/calendar/actions.ts");
const visitRepository = await import("../src/server/visits/repository.ts");
const templateActions = await import("../src/app/(workspace)/settings/template-actions.ts");
const chatActions = await import("../src/app/(workspace)/chat/actions.ts");
const { AuthorizationError } = await import("../src/server/auth/permissions.ts");
const storage = await import("../src/server/documents/storage.ts");
const previous = { status: "idle", message: null, fieldErrors: {} };
const content = Buffer.from("%PDF-1.4\nFinance receipt evidence\n");

test("uploads retain committed bytes and finance retries preserve file ownership", { timeout: 60_000 }, async (t) => {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const name = `crm_receipts_test_${randomUUID().replaceAll("-", "")}`;
  const directory = await mkdtemp(join(tmpdir(), "crm-receipts-test-"));
  const originalStorageRoot = process.env.DOCUMENT_STORAGE_ROOT;
  process.env.DOCUMENT_STORAGE_ROOT = directory;
  let databaseCreated = false;
  t.after(async () => {
    mock.restoreAll();
    hooks.deregister();
    if (originalStorageRoot === undefined) delete process.env.DOCUMENT_STORAGE_ROOT;
    else process.env.DOCUMENT_STORAGE_ROOT = originalStorageRoot;
    await sql?.end();
    try { if (databaseCreated) await admin`DROP DATABASE ${admin(name)}`; }
    finally { await admin.end(); await rm(directory, { recursive: true, force: true }); }
  });
  await admin`CREATE DATABASE ${admin(name)}`;
  databaseCreated = true;
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const log = mock.method(console, "error", () => {});
  t.beforeEach(() => {
    revalidatePath.mock.resetCalls();
    revalidatePath.mock.mockImplementation(() => {});
    log.mock.resetCalls();
  });

  async function fixture() {
    const [organization] = await sql`INSERT INTO organizations (name, timezone)
      VALUES ('Receipt test company', 'Europe/Moscow') RETURNING id`;
    const [author] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
      VALUES (${organization.id}, 'Receipt tester', 'receipts@example.invalid', 'admin') RETURNING id`;
    const member = { organizationId: organization.id, memberId: author.id, role: "admin", permissionOverrides: {}, sessionId: null };
    const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${organization.id}, 'Test customer') RETURNING id`;
    const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
      VALUES (${organization.id}, ${client.id}, 'Test object', 'Office', 'Test address') RETURNING id`;
    const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
      VALUES (${organization.id}, 'Test master', '+70000000000', '+70000000000', 'Test region', 'Test zone') RETURNING id`;
    const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
      client_name_snapshot, object_name_snapshot, object_address_snapshot, assigned_master_id, master_name_snapshot,
      agreed_total_minor, master_payment_snapshot_minor)
      VALUES (${organization.id}, ${client.id}, ${object.id}, 'receipt-1', 'new', 'RUB',
        'Test customer', 'Test object', 'Test address', ${master.id}, 'Test master', 100000, 100000) RETURNING id`;
    const [{ today }] = await sql`SELECT (now() AT TIME ZONE 'Europe/Moscow')::date::text AS today`;
    const invoiceId = await finance.createInvoice(member, {
      idempotencyKey: randomUUID(), orderId: order.id, invoiceNumber: 'receipt-invoice',
      amount: '1000', issuedOn: today, dueOn: today, note: null,
    });
    sessionMember = member;
    return { member, orderId: order.id, masterId: master.id, invoiceId, today };
  }

  function request(fixture, amount = "100") {
    const payload = new FormData();
    for (const [field, value] of Object.entries({
      idempotencyKey: randomUUID(), receiptDocumentId: randomUUID(), orderId: fixture.orderId, invoiceId: fixture.invoiceId,
      amount, receivedOn: fixture.today, paidOn: fixture.today, paymentMethod: "cash", reference: "", note: "",
    })) payload.set(field, value);
    payload.set("receipt", new File([content], "receipt.pdf", { type: "application/pdf" }));
    const key = storage.createDocumentStorageKey(fixture.member.organizationId, payload.get("receiptDocumentId"), "pdf");
    return { payload, key, path: join(directory, key) };
  }

  async function assertSaved(fixture, request, table) {
    const entries = await sql`SELECT receipt_document_id FROM ${sql(table)}
      WHERE organization_id = ${fixture.member.organizationId} AND idempotency_key = ${request.payload.get("idempotencyKey")}`;
    assert.equal(entries.length, 1);
    assert.equal(entries[0].receipt_document_id, request.payload.get("receiptDocumentId"));
    const [version] = await sql`SELECT storage_key, size_bytes, sha256 FROM document_versions
      WHERE organization_id = ${fixture.member.organizationId} AND document_id = ${entries[0].receipt_document_id}`;
    assert.equal(version.storage_key, request.key);
    assert.equal(Number(version.size_bytes), content.length);
    assert.equal(version.sha256, createHash("sha256").update(content).digest("hex"));
    assert.deepEqual(await storage.readVerifiedDocumentFile(version.storage_key, { sizeBytes: Number(version.size_bytes), sha256: version.sha256 }, 1024), content);
  }

  for (const [kind, action, table] of [
    ["payment", actions.createPaymentAction, "order_payments"],
    ["payout", actions.createPayoutAction, "order_master_payouts"],
  ]) {
    const operation = `finance.${kind}.create`;
    await t.test(`${kind}: commit, metadata integrity, confirmed retry and tenant isolation`, async () => {
      const own = await fixture();
      const submission = request(own);
      assert.equal(await finance.financeMutationExists(own.member, submission.payload.get("idempotencyKey"), operation), false);
      assert.equal((await action(previous, submission.payload)).status, "success");
      await assertSaved(own, submission, table);
      assert.equal(await finance.financeMutationExists(own.member, submission.payload.get("idempotencyKey"), operation), true);
      submission.payload.set("receipt", new File(["Invalid replacement must not be read"], "receipt.pdf", { type: "application/pdf" }));
      assert.equal((await action(previous, submission.payload)).status, "success");
      await assertSaved(own, submission, table);
      const other = await fixture();
      assert.equal(await finance.financeMutationExists(other.member, submission.payload.get("idempotencyKey"), operation), false);
      submission.payload.set("receipt", new File([content], "receipt.pdf", { type: "application/pdf" }));
      const rejected = await action(previous, submission.payload);
      assert.equal(rejected.status, "error");
      assert.match(rejected.message, /больше недоступна/);
      const foreignKey = storage.createDocumentStorageKey(other.member.organizationId, submission.payload.get("receiptDocumentId"), "pdf");
      await assert.rejects(readFile(join(directory, foreignKey)), { code: "ENOENT" });
      await assertSaved(own, submission, table);
      const denied = { ...own.member, permissionOverrides: { "finance.write": false } };
      await assert.rejects(finance.financeMutationExists(denied, submission.payload.get("idempotencyKey"), operation), AuthorizationError);
    });
    await t.test(`${kind}: post-commit refresh failure retains the receipt and reports saved state`, async () => {
      const own = await fixture();
      const submission = request(own);
      revalidatePath.mock.mockImplementation(() => { throw new Error("Injected cache failure"); });
      const result = await action(previous, submission.payload);
      assert.equal(result.status, "success");
      assert.equal(result.refreshRequired, true);
      assert.equal(log.mock.callCount(), 1);
      await assertSaved(own, submission, table);
    });
    await t.test(`${kind}: permission denial precedes receipt creation`, async () => {
      const own = await fixture();
      const submission = request(own);
      sessionMember = { ...own.member, permissionOverrides: { "finance.write": false } };
      const result = await action(previous, submission.payload);
      assert.equal(result.status, "error");
      assert.match(result.message, /нет права/);
      await assert.rejects(readFile(submission.path), { code: "ENOENT" });
    });
    await t.test(`${kind}: lost COMMIT acknowledgement preserves the receipt and retry does not duplicate money`, { timeout: 10_000 }, async () => {
      const own = await fixture();
      const submission = request(own);
      const directSql = sql;
      const proxy = await startCommitLossProxy(url.toString());
      const interruptedSql = postgres(proxy.databaseUrl, { max: 1, ssl: false, connect_timeout: 2, onnotice: () => {} });
      try {
        sql = interruptedSql;
        const result = await action(previous, submission.payload);
        assert.equal(proxy.droppedCommits, 1, "The server must confirm COMMIT before its connection is cut");
        assert.deepEqual(proxy.errors, []);
        assert.equal(result.status, "error");
        assert.match(result.message, /Не удалось подтвердить/);
        assert.equal(revalidatePath.mock.callCount(), 0);
        assert.equal(log.mock.callCount(), 1);

        // Observe persistence through an independent connection, not the proxy.
        sql = directSql;
        await assertSaved(own, submission, table);
        assert.equal(await finance.financeMutationExists(own.member, submission.payload.get("idempotencyKey"), operation), true);

        // The reconnecting client must use the committed request key without
        // reading/replacing the already saved receipt or posting money again.
        sql = interruptedSql;
        submission.payload.set("receipt", new File(["Must not replace the committed receipt"], "receipt.pdf", { type: "application/pdf" }));
        assert.equal((await action(previous, submission.payload)).status, "success");
        sql = directSql;
        await assertSaved(own, submission, table);
        const [{ count, amount }] = await sql`SELECT count(*)::integer AS count, sum(amount_minor)::integer AS amount
          FROM ${sql(table)} WHERE organization_id = ${own.member.organizationId}`;
        assert.equal(count, 1);
        assert.equal(amount, 10000);
        const [{ audits }] = await sql`SELECT count(*)::integer AS audits FROM audit_events
          WHERE organization_id = ${own.member.organizationId} AND action = ${operation}`;
        assert.equal(audits, 1);
        assert.equal(proxy.droppedCommits, 1);
        assert.deepEqual(proxy.errors, []);
      } finally {
        sql = directSql;
        try { await interruptedSql.end({ timeout: 1 }); }
        finally { await proxy.close(); }
      }
    });
    for (const outcome of ["commit", "rollback", "different receipt ID"]) {
      await t.test(`${kind}: concurrent pending retry preserves file ownership (${outcome})`, async () => {
        const rollback = outcome === "rollback";
        const own = await fixture();
        const submission = request(own, rollback ? "2000" : "100");
        const locked = Promise.withResolvers();
        const release = Promise.withResolvers();
        const blocker = sql.begin(async (transaction) => {
          if (kind === "payment") await transaction`SELECT id FROM order_invoices WHERE id = ${own.invoiceId} FOR UPDATE`;
          else await transaction`SELECT id FROM orders WHERE id = ${own.orderId} FOR UPDATE`;
          locked.resolve();
          await release.promise;
        });
        let owner;
        let duplicate;
        let duplicateRequest;
        try {
          await Promise.race([locked.promise, blocker.then(() => { throw new Error("Lock ended before readiness"); })]);
          owner = action(previous, submission.payload);
          for (let attempt = 0; ; attempt += 1) {
            try { assert.deepEqual(await readFile(submission.path), content); break; }
            catch (error) { if (error.code !== "ENOENT" || attempt >= 100) throw error; await delay(10); }
          }
          if (outcome === "different receipt ID") {
            for (let attempt = 0; ; attempt += 1) {
              const [{ count }] = await sql`SELECT count(*)::integer AS count FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'`;
              if (count > 0) break;
              assert.ok(attempt < 100, "The first mutation must hold the request key while waiting for the ledger lock");
              await delay(10);
            }
            duplicateRequest = request(own);
            duplicateRequest.payload.set("idempotencyKey", submission.payload.get("idempotencyKey"));
            duplicate = action(previous, duplicateRequest.payload);
            for (let attempt = 0; ; attempt += 1) {
              try { assert.deepEqual(await readFile(duplicateRequest.path), content); break; }
              catch (error) { if (error.code !== "ENOENT" || attempt >= 100) throw error; await delay(10); }
            }
          } else {
            const retry = await action(previous, submission.payload);
            assert.equal(retry.status, "error");
            assert.match(retry.fieldErrors.receipt[0], /уже существует/);
          }
          assert.deepEqual(await readFile(submission.path), content);
        } finally { release.resolve(); await blocker; }
        const result = await owner;
        if (duplicate) {
          assert.equal((await duplicate).status, "success");
          await assert.rejects(readFile(duplicateRequest.path), { code: "ENOENT" });
        }
        if (rollback) {
          assert.equal(result.status, "error");
          await assert.rejects(readFile(submission.path), { code: "ENOENT" });
          assert.equal(await finance.financeMutationExists(own.member, submission.payload.get("idempotencyKey"), operation), false);
          const [{ count }] = await sql`SELECT count(*)::integer AS count FROM ${sql(table)} WHERE organization_id = ${own.member.organizationId}`;
          assert.equal(count, 0);
        } else {
          assert.equal(result.status, "success");
          await assertSaved(own, submission, table);
          assert.equal((await action(previous, submission.payload)).status, "success");
          await assertSaved(own, submission, table);
        }
      });
    }
  }
  for (const versionUpload of [false, true]) {
    await t.test(`${versionUpload ? "document version" : "document"}: lost COMMIT acknowledgement retains history and retry is idempotent`, { timeout: 10_000 }, async () => {
      const own = await fixture();
      const documentId = randomUUID();
      const payload = new FormData();
      for (const [field, value] of Object.entries({
        idempotencyKey: documentId, orderId: own.orderId, category: "other",
        title: "Commit loss evidence", description: "",
      })) payload.set(field, value);
      payload.set("file", new File([content], "evidence.pdf", { type: "application/pdf" }));
      const revisedContent = Buffer.from("%PDF-1.4\nRevised commit loss evidence\n");
      if (versionUpload) {
        assert.equal((await documentActions.uploadDocumentAction(previous, payload)).status, "success");
        payload.set("idempotencyKey", randomUUID());
        payload.set("documentId", documentId);
        payload.set("expectedVersion", "1");
        payload.set("changeNote", "Preserve the original version");
        payload.set("file", new File([revisedContent], "evidence.pdf", { type: "application/pdf" }));
        revalidatePath.mock.resetCalls();
      }
      const action = versionUpload ? documentActions.uploadDocumentVersionAction : documentActions.uploadDocumentAction;
      const directSql = sql;
      const proxy = await startCommitLossProxy(url.toString());
      const interruptedSql = postgres(proxy.databaseUrl, { max: 1, ssl: false, connect_timeout: 2, onnotice: () => {} });
      async function assertHistory() {
        const documents = await directSql`SELECT current_version_id, version FROM documents
          WHERE organization_id = ${own.member.organizationId} AND id = ${documentId}`;
        assert.equal(documents.length, 1);
        assert.equal(documents[0].version, versionUpload ? 2 : 1);
        const versions = await directSql`SELECT id, version_number, storage_key, size_bytes, sha256 FROM document_versions
          WHERE organization_id = ${own.member.organizationId} AND document_id = ${documentId} ORDER BY version_number`;
        assert.equal(versions.length, versionUpload ? 2 : 1);
        assert.equal(documents[0].current_version_id, versions.at(-1).id);
        for (const [index, version] of versions.entries()) {
          const expected = index === 0 ? content : revisedContent;
          assert.equal(version.version_number, index + 1);
          assert.equal(version.storage_key, storage.createDocumentVersionStorageKey(own.member.organizationId, documentId, index + 1, "pdf"));
          assert.equal(Number(version.size_bytes), expected.length);
          assert.equal(version.sha256, createHash("sha256").update(expected).digest("hex"));
          assert.deepEqual(await storage.readVerifiedDocumentFile(version.storage_key, { sizeBytes: Number(version.size_bytes), sha256: version.sha256 }, 1024), expected);
        }
        const [{ count }] = await directSql`SELECT count(*)::integer AS count FROM audit_events
          WHERE organization_id = ${own.member.organizationId} AND entity_id = ${documentId}
            AND action = ${versionUpload ? "document.version_created" : "document.created"}`;
        assert.equal(count, 1);
      }
      try {
        sql = interruptedSql;
        const result = await action(previous, payload);
        assert.equal(proxy.droppedCommits, 1);
        assert.deepEqual(proxy.errors, []);
        assert.equal(result.status, "error");
        assert.match(result.message, /Не удалось подтвердить/);
        assert.equal(revalidatePath.mock.callCount(), 0);
        assert.equal(log.mock.callCount(), 1);
        await assertHistory();
        assert.equal((await action(previous, payload)).status, "success");
        await assertHistory();
        assert.equal(proxy.droppedCommits, 1);
        assert.deepEqual(proxy.errors, []);
      } finally {
        sql = directSql;
        try { await interruptedSql.end({ timeout: 1 }); }
        finally { await proxy.close(); }
      }
    });
  }
  for (const [kind, action, table, parentColumn, image] of [
    ["closing act", visitActions.completeVisitAction, "document_versions", "document_id", false],
    ["visit photo", visitActions.uploadAssignedVisitEvidenceAction, "document_versions", "document_id", true],
    ["template", templateActions.uploadDocumentTemplateAction, "document_template_versions", "template_id", false],
    ["chat attachment", chatActions.sendChatMessageAction, "chat_message_attachments", "message_id", false],
    ["chat avatar", chatActions.updateChatChannelSettingsAction, "chat_channel_avatars", "channel_id", true],
  ]) {
    for (const failure of ["cache", "lost COMMIT"]) {
      await t.test(`${kind}: ${failure} preserves actual file references`, { timeout: 10_000 }, async () => {
        const own = await fixture();
        const requestId = randomUUID();
        const payload = new FormData();
        for (const [field, value] of Object.entries({
          idempotencyKey: requestId, expectedVersion: "1", actTitle: "Signed closing act", completionNotes: "Work completed",
          kind: "work_photo", note: "", title: "Approved template", description: "", body: "Uploaded evidence", name: "Test channel",
        })) payload.set(field, value);
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const bytes = image ? png : content;
        payload.set(kind === "chat avatar" ? "avatar" : "file", new File([bytes], image ? "image.png" : "file.pdf", { type: image ? "image/png" : "application/pdf" }));
        let parentId = requestId;
        let visitId;
        let previousAvatarKey;
        if (kind === "closing act" || kind === "visit photo") {
          visitId = await visitRepository.createVisit(own.member, {
            idempotencyKey: randomUUID(), orderId: own.orderId, localDate: own.today,
            localTime: "10:00", durationMinutes: 60, assignedMasterId: own.masterId, notes: null,
          });
          payload.set("visitId", visitId);
          if (kind === "visit photo") {
            const [technician] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
              VALUES (${own.member.organizationId}, 'Test technician', 'master@example.invalid', 'master', ${own.masterId}) RETURNING id`;
            sessionMember = { ...own.member, memberId: technician.id, role: "master", masterId: own.masterId };
          }
        } else if (kind.startsWith("chat")) {
          const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, created_by)
            VALUES (${own.member.organizationId}, 'Test channel', 'group', 'office', ${own.member.memberId}) RETURNING id`;
          await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
            VALUES (${own.member.organizationId}, ${channel.id}, ${own.member.memberId}, 'owner', ${own.member.memberId})`;
          payload.set("channelId", channel.id);
          if (kind === "chat avatar") {
            parentId = channel.id;
            previousAvatarKey = storage.createChatChannelAvatarStorageKey(own.member.organizationId, channel.id, 1, "png");
            await storage.writeDocumentFile(previousAvatarKey, png);
            await sql`INSERT INTO chat_channel_avatars (organization_id, channel_id, storage_key, mime_type, size_bytes, sha256, uploaded_by)
              VALUES (${own.member.organizationId}, ${channel.id}, ${previousAvatarKey}, 'image/png', ${png.length},
                ${createHash("sha256").update(png).digest("hex")}, ${own.member.memberId})`;
          }
        }
        const key = storage.createDocumentVersionStorageKey(own.member.organizationId, parentId, kind === "chat avatar" ? 2 : 1, image ? "png" : "pdf");
        const directSql = sql;
        const proxy = failure === "lost COMMIT" ? await startCommitLossProxy(url.toString()) : null;
        const interruptedSql = proxy ? postgres(proxy.databaseUrl, { max: 1, ssl: false, connect_timeout: 2, onnotice: () => {} }) : null;
        async function assertReference() {
          const versions = await directSql`SELECT storage_key, size_bytes, sha256 FROM ${directSql(table)}
            WHERE organization_id = ${own.member.organizationId} AND ${directSql(parentColumn)} = ${parentId}`;
          assert.equal(versions.length, 1);
          const version = versions[0];
          assert.equal(version.storage_key, key);
          assert.equal(Number(version.size_bytes), bytes.length);
          assert.equal(version.sha256, createHash("sha256").update(bytes).digest("hex"));
          assert.deepEqual(await storage.readVerifiedDocumentFile(key, { sizeBytes: bytes.length, sha256: version.sha256 }, 1024), bytes);
          if (kind === "closing act") {
            const [visit] = await directSql`SELECT status, completion_document_id, version FROM service_visits WHERE id = ${visitId}`;
            assert.deepEqual(visit, { status: "completed", completion_document_id: requestId, version: 2 });
          }
          if (kind === "chat avatar") {
            const [channel] = await directSql`SELECT version FROM chat_channels WHERE id = ${parentId}`;
            assert.equal(channel.version, 2);
          }
        }
        try {
          revalidatePath.mock.resetCalls();
          if (interruptedSql) sql = interruptedSql;
          else revalidatePath.mock.mockImplementation(() => { throw new Error("Cache unavailable after commit"); });
          const result = await action(previous, payload);
          assert.equal(log.mock.callCount(), 1);
          if (proxy) {
            assert.equal(proxy.droppedCommits, 1);
            assert.deepEqual(proxy.errors, []);
            assert.equal(result.status, "error");
            assert.match(result.message, /Не удалось подтвердить/);
            assert.equal(revalidatePath.mock.callCount(), 0);
          } else {
            assert.equal(result.status, "success", result.message);
            assert.equal(result.refreshRequired, true);
          }
          await assertReference();
          if (previousAvatarKey) {
            if (proxy) assert.deepEqual(await readFile(join(directory, previousAvatarKey)), png);
            else await assert.rejects(readFile(join(directory, previousAvatarKey)), { code: "ENOENT" });
          }
          revalidatePath.mock.mockImplementation(() => {});
          const retry = await action(previous, payload);
          // Avatar updates use optimistic versions rather than request keys.
          // A stale retry must be rejected without touching the committed image.
          assert.equal(retry.status, kind === "chat avatar" ? "error" : "success", retry.message);
          await assertReference();
        } finally {
          sql = directSql;
          try { await interruptedSql?.end({ timeout: 1 }); }
          finally { await proxy?.close(); }
        }
      });
    }
  }
  await t.test("mismatched and incomplete request keys are explicit conflicts", async () => {
    const own = await fixture();
    for (const [operation, entityId] of [["finance.payout.create", randomUUID()], ["finance.payment.create", null]]) {
      const key = randomUUID();
      await sql`INSERT INTO idempotency_requests (organization_id, idempotency_key, operation, entity_id)
        VALUES (${own.member.organizationId}, ${key}, ${operation}, ${entityId})`;
      await assert.rejects(finance.financeMutationExists(own.member, key, "finance.payment.create"), finance.FinanceRequestConflictError);
    }
  });
});
