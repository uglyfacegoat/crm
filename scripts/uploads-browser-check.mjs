import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection, createServer } from "node:net";
import { chromium, request } from "playwright-core";
import postgres from "postgres";
import { unzipSync, zipSync } from "fflate";
import { runMigrations } from "./migrate.mjs";
import { setFileWriteMode } from "./file-write-drain.mjs";
import { startS3Fixture } from "./fixtures/s3-server.mjs";
import { startCommitLossProxy } from "./fixtures/postgres-commit-proxy.mjs";
import { createS3Storage } from "../src/server/storage/s3-store.mjs";
import { withStorageSnapshot } from "./backup-snapshot.mjs";
import { verifyRestoredFiles } from "./backup-integrity.mjs";
import { FILE_PROCESSING_LOCK_CLASS, FILE_PROCESSING_SLOTS } from "../src/server/file-scan/processing-lock-key.mjs";
import { pdfFixture } from "./fixtures/pdf.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
const runtime = process.env.UPLOAD_CHECK_RUNTIME;
const storageMode = process.env.UPLOAD_CHECK_STORAGE ?? "local";
assert.ok(["local", "s3"].includes(storageMode), "UPLOAD_CHECK_STORAGE must be local or s3");
if (!adminUrl || !runtime) throw new Error("Set MIGRATION_TEST_ADMIN_URL to isolated PostgreSQL and UPLOAD_CHECK_RUNTIME to a built standalone server.js.");
const baseUrl = "http://127.0.0.1:3100";
const directory = await mkdtemp(join(tmpdir(), "crm-upload-browser-"));
const artifacts = resolve(process.env.UPLOAD_CHECK_ARTIFACTS ?? "artifacts/uploads");
await mkdir(artifacts, { recursive: true });
const databaseName = `crm_upload_browser_${randomUUID().replaceAll("-", "")}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
const environment = {
  ...process.env, DATABASE_URL: databaseUrl.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), CRM_WEBSITE_WEBHOOK_SECRET: randomBytes(32).toString("hex"),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: randomBytes(32).toString("hex"), AUTH_BOOTSTRAP_ADMIN_EMAIL: "uploads@example.invalid",
  AUTH_BOOTSTRAP_ADMIN_NAME: "Upload tester", AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Upload test company",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", DOCUMENT_STORAGE_ROOT: directory,
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3100", SMOKE_BASE_URL: baseUrl,
};
let databaseCreated = false;
let sql;
let server;
let serverExit;
let browser;
let page;
let archiveClient;
let s3Fixture;
let objectStorage;
let scannerProxy;
let commitProxy;
let disableScanner;
let stallScanner;
let resumeScanner;
try {
  if (process.env.UPLOAD_CHECK_SCANNER_FAILURE === "true") {
    assert.equal(environment.CRM_FILE_SCAN_MODE, "required");
    environment.CRM_CLAMD_TIMEOUT_MS = "2000";
    const upstreamHost = environment.CRM_CLAMD_HOST;
    const upstreamPort = Number(environment.CRM_CLAMD_PORT);
    let scannerMode = "forward";
    const sockets = new Set();
    scannerProxy = createServer((client) => {
      sockets.add(client);
      client.on("close", () => sockets.delete(client));
      client.on("error", () => {});
      if (scannerMode === "down") { client.destroy(); return; }
      if (scannerMode === "stall") { client.on("data", () => {}); return; }
      const upstream = createConnection({ host: upstreamHost, port: upstreamPort });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      client.pipe(upstream).pipe(client);
    });
    await new Promise((resolveListening) => scannerProxy.listen(0, "127.0.0.1", resolveListening));
    environment.CRM_CLAMD_HOST = "127.0.0.1";
    environment.CRM_CLAMD_PORT = String(scannerProxy.address().port);
    stallScanner = () => { scannerMode = "stall"; };
    resumeScanner = () => { scannerMode = "forward"; };
    disableScanner = () => { scannerMode = "down"; for (const socket of sockets) socket.destroy(); };
  }
  if (storageMode === "s3") {
    s3Fixture = await startS3Fixture();
    Object.assign(environment, s3Fixture.environment);
    objectStorage = createS3Storage(s3Fixture.environment);
  } else {
    environment.DOCUMENT_STORAGE_BACKEND = "local";
  }
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  databaseCreated = true;
  await runMigrations({ databaseUrl: environment.DATABASE_URL, onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0, "Test administrator bootstrap failed");
  sql = postgres(environment.DATABASE_URL, { max: 2 });
  server = spawn(process.execPath, [resolve(runtime)], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); }
    });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().tracing.start({ screenshots: true, snapshots: true });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  await page.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  archiveClient = await request.newContext({ storageState: await page.context().storageState() });
  assert.ok((await page.locator("body").innerText()).includes("Сегодня в работе"));
  assert.equal(await page.locator("[data-nextjs-dialog]").count(), 0);
  await page.screenshot({ path: join(artifacts, "home.png"), animations: "disabled" });
  console.log("Standalone browser startup: home renders, login/navigation work, no error overlay.");
  const smoke = spawn(process.execPath, ["scripts/production-smoke-check.mjs"], { env: environment, stdio: "inherit" });
  assert.equal((await once(smoke, "exit"))[0], 0, "Production HTTP smoke failed");

  const [member] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${environment.AUTH_BOOTSTRAP_ADMIN_EMAIL}`;
  const [client] = await sql`INSERT INTO clients (organization_id, legal_name) VALUES (${member.organization_id}, 'Upload customer') RETURNING id`;
  const [object] = await sql`INSERT INTO client_objects (organization_id, client_id, name, object_type, address)
    VALUES (${member.organization_id}, ${client.id}, 'Upload object', 'Office', 'Test address') RETURNING id`;
  const [master] = await sql`INSERT INTO masters (organization_id, full_name, phone, normalized_phone, service_region, service_zone)
    VALUES (${member.organization_id}, 'Upload master', '+70000000000', '+70000000000', 'Test region', 'Test zone') RETURNING id`;
  const [order] = await sql`INSERT INTO orders (organization_id, client_id, object_id, order_number, status, currency,
    client_name_snapshot, object_name_snapshot, object_address_snapshot, assigned_master_id, master_name_snapshot,
    agreed_total_minor, master_payment_snapshot_minor)
    VALUES (${member.organization_id}, ${client.id}, ${object.id}, 'UPLOAD-1', 'new', 'RUB',
      'Upload customer', 'Upload object', 'Test address', ${master.id}, 'Upload master', 100000, 100000) RETURNING id`;
  await sql`INSERT INTO order_invoices (organization_id, order_id, invoice_number, amount_minor, issued_on, due_on, idempotency_key, created_by)
    VALUES (${member.organization_id}, ${order.id}, 'UPLOAD-INVOICE', 100000, current_date, current_date, ${randomUUID()}, ${member.id})`;

  let warningResponse = null;
  let replaced = 0;
  let interceptionError = null;
  let duplicateDocumentPost = false;
  let duplicateDocumentResponse = null;
  let duplicateFinancePost = false;
  let duplicateFinanceResponse = null;
  let duplicateOtherPost = null;
  let duplicateOtherResponse = null;
  // This injects the already-tested action state, not a backend cache failure.
  await page.route("**/*", async (route) => {
    if (duplicateDocumentPost && route.request().method() === "POST" && route.request().headers()["next-action"]
      && new URL(route.request().url()).pathname === "/documents") {
      duplicateDocumentPost = false;
      try {
        const [response, duplicate] = await Promise.all([
          route.fetch(),
          archiveClient.post(route.request().url(), {
            data: route.request().postDataBuffer(),
            headers: route.request().headers(),
          }),
        ]);
        duplicateDocumentResponse = { status: duplicate.status(), body: await duplicate.text() };
        await route.fulfill({ response });
      } catch (error) { interceptionError = error; await route.abort(); }
      return;
    }
    if (duplicateFinancePost && route.request().method() === "POST" && route.request().headers()["next-action"]
      && new URL(route.request().url()).pathname === "/finance") {
      duplicateFinancePost = false;
      try {
        const [response, duplicate] = await Promise.all([
          route.fetch(),
          archiveClient.post(route.request().url(), {
            data: route.request().postDataBuffer(),
            headers: route.request().headers(),
          }),
        ]);
        duplicateFinanceResponse = { status: duplicate.status(), body: await duplicate.text() };
        await route.fulfill({ response });
      } catch (error) { interceptionError = error; await route.abort(); }
      return;
    }
    if (duplicateOtherPost && route.request().method() === "POST" && route.request().headers()["next-action"]
      && new URL(route.request().url()).pathname === duplicateOtherPost) {
      duplicateOtherPost = null;
      try {
        const [response, duplicate] = await Promise.all([
          route.fetch(),
          archiveClient.post(route.request().url(), {
            data: route.request().postDataBuffer(),
            headers: route.request().headers(),
          }),
        ]);
        duplicateOtherResponse = { status: duplicate.status(), body: await duplicate.text() };
        await route.fulfill({ response });
      } catch (error) { interceptionError = error; await route.abort(); }
      return;
    }
    if (!warningResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    const expected = warningResponse;
    warningResponse = null;
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      const body = await response.text();
      const needle = `"status":"success","message":${JSON.stringify(expected.saved)}`;
      assert.equal(body.split(needle).length, 2, "Exactly one real saved action result must be replaced");
      const replacement = `"status":"success","message":${JSON.stringify(expected.warning)},"refreshRequired":true`;
      await route.fulfill({ response, body: body.replace(needle, replacement) });
      replaced += 1;
    } catch (error) { interceptionError = error; await route.abort(); }
  });

  async function submit(dialog, label, warning, screenshot, savedLabel = "Сохранено") {
    const before = replaced;
    warningResponse = warning;
    await dialog.getByRole("button", { name: label, exact: true }).click();
    if (warning) {
      await dialog.getByRole("status").filter({ hasText: warning.warning }).waitFor();
      if (interceptionError) throw interceptionError;
      assert.equal(replaced, before + 1);
      // All success auto-close timers are <= 1100 ms; test retention beyond that boundary.
      await page.waitForTimeout(1_200);
      assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.getByRole("button", { name: savedLabel, exact: true }).isDisabled(), true);
      await dialog.getByRole("status").scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(artifacts, screenshot) });
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    }
    await dialog.waitFor({ state: "hidden" });
  }

  async function verifyVersion(documentId, versionNumber, bytes, denyMasterDownload = false) {
    const [version] = await sql`SELECT id, storage_key, sha256, size_bytes FROM document_versions
      WHERE organization_id = ${member.organization_id} AND document_id = ${documentId} AND version_number = ${versionNumber}`;
    assert.ok(version, "Uploaded version must persist");
    assert.equal(Number(version.size_bytes), bytes.length);
    assert.equal(version.sha256, createHash("sha256").update(bytes).digest("hex"));
    const stored = objectStorage
      ? await objectStorage.readVerified(version.storage_key, { sizeBytes: Number(version.size_bytes), sha256: version.sha256 }, 15 * 1024 * 1024)
      : await readFile(join(directory, version.storage_key));
    assert.deepEqual(stored, bytes);
    const downloadUrl = `${baseUrl}/api/v1/documents/${documentId}/versions/${version.id}/download`;
    if (denyMasterDownload) {
      const deniedDownload = await page.request.get(downloadUrl);
      assert.equal(deniedDownload.status(), 403, "Master must not gain archive download permissions through an upload");
    }
    const download = await archiveClient.get(downloadUrl);
    assert.equal(download.status(), 200);
    assert.deepEqual(await download.body(), bytes);
  }

  async function withProcessingSlotsHeld(work) {
    const first = await sql.reserve();
    const second = await sql.reserve();
    let firstLocked = false;
    let secondLocked = false;
    try {
      await first`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
      firstLocked = true;
      await second`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
      secondLocked = true;
      await work();
    } finally {
      try {
        if (secondLocked) await second`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
        if (firstLocked) await first`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
      } finally {
        second.release();
        first.release();
      }
    }
  }

  async function verifyStoredReference(table, column, id, bytes) {
    const references = await sql`SELECT storage_key, size_bytes, sha256 FROM ${sql(table)}
      WHERE organization_id = ${member.organization_id} AND ${sql(column)} = ${id}`;
    assert.equal(references.length, 1);
    assert.equal(Number(references[0].size_bytes), bytes.length);
    assert.equal(references[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    const reference = references[0];
    const stored = objectStorage
      ? await objectStorage.readVerified(reference.storage_key, { sizeBytes: Number(reference.size_bytes), sha256: reference.sha256 }, 15 * 1024 * 1024)
      : await readFile(join(directory, reference.storage_key));
    assert.deepEqual(stored, bytes);
  }
  const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4////fwAJ+wP9CNHoHgAAAABJRU5ErkJggg==", "base64");

  for (const warn of [false, true]) {
    await page.setViewportSize(warn ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const suffix = warn ? "warning" : "normal";
    const documentBytes = pdfFixture(`Document ${suffix}`);
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    let dialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
    await dialog.locator('summary[aria-label="Заказ"]').click();
    await dialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await dialog.locator('input[name="title"]').fill(`Upload ${suffix}`);
    await dialog.locator('input[name="file"]').setInputFiles({ name: "document.pdf", mimeType: "application/pdf", buffer: documentBytes });
    const documentId = await dialog.locator('input[name="idempotencyKey"]').inputValue();
    if (!warn) duplicateDocumentPost = true;
    if (warn) {
      await submit(dialog, "Загрузить документ", { saved: "Документ сохранён в архиве.", warning: "Документ сохранён, но страницу не удалось обновить. Обновите её вручную." }, "document-warning.png");
    } else {
      await dialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("status").innerText(), /документ не подтверждён|Документ уже загружен/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
    }
    if (!warn) {
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateDocumentResponse, "Concurrent duplicate POST must run");
      assert.equal(duplicateDocumentResponse.status, 200);
      assert.match(duplicateDocumentResponse.body, /Документ уже загружен|документ не подтверждён|Документ сохранён в архиве/);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE organization_id = ${member.organization_id} AND id = ${documentId}`)[0].count, 1);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE organization_id = ${member.organization_id} AND document_id = ${documentId}`)[0].count, 1);
    }
    await verifyVersion(documentId, 1, documentBytes);
    await page.goto(`${baseUrl}/documents?document=${documentId}`);
    await page.getByRole("button", { name: "Новая версия", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Новая версия документа", exact: true });
    const versionBytes = pdfFixture(`Version two ${suffix}`);
    await dialog.locator('input[name="file"]').setInputFiles({ name: "version.pdf", mimeType: "application/pdf", buffer: versionBytes });
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/documents";
      await dialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("status").innerText(), /Следующая версия уже загружается|Эта версия уже загружена|Версия 2 сохранена/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate document-version POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Следующая версия уже загружается|Эта версия уже загружена|Версия 2 сохранена/i);
    } else {
      await submit(dialog, "Сохранить версию 2", { saved: "Версия 2 сохранена. Предыдущие файлы доступны в истории.", warning: "Новая версия сохранена, но страницу не удалось обновить. Обновите её вручную." }, "version-warning.png");
    }
    await verifyVersion(documentId, 1, documentBytes);
    await verifyVersion(documentId, 2, versionBytes);
    if (!warn) {
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${documentId}`)[0].count, 2);
      console.log("concurrent document version: two identical requests added one version and preserved both file bytes.");
    }
    const currentDownload = await archiveClient.get(`${baseUrl}/api/v1/documents/${documentId}/download`);
    assert.equal(currentDownload.status(), 200);
    assert.deepEqual(await currentDownload.body(), versionBytes);
    const archiveDownload = await archiveClient.post(`${baseUrl}/api/v1/documents/export`, {
      headers: { origin: baseUrl }, data: { documentIds: [documentId] },
    });
    assert.equal(archiveDownload.status(), 200);
    const archivedFiles = Object.values(unzipSync(await archiveDownload.body()));
    assert.equal(archivedFiles.length, 1);
    assert.deepEqual(Buffer.from(archivedFiles[0]), versionBytes);
    console.log(`${suffix}: document, historical versions and ZIP bytes match; dialog behavior verified.`);

    for (const kind of ["payment", "payout"]) {
      await page.goto(`${baseUrl}/finance`);
      if (kind === "payment") {
        const summary = page.locator("summary").filter({ hasText: "UPLOAD-1" }).first();
        if (await summary.locator("..").getAttribute("open") === null) await summary.click();
        await page.getByRole("button", { name: "Добавить оплату", exact: true }).click();
      } else {
        await page.getByRole("tab", { name: "Мастера", exact: true }).click();
        await page.getByRole("button", { name: "Провести выплату", exact: true }).click();
      }
      dialog = page.getByRole("dialog", { name: kind === "payment" ? "Оплата клиента" : "Выплата мастеру", exact: true });
      const receiptBytes = pdfFixture(`Receipt ${kind} ${suffix}`);
      await dialog.locator('input[name="amount"]').fill("100");
      await dialog.locator('input[name="receipt"]').setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: receiptBytes });
      const receiptId = await dialog.locator('input[name="receiptDocumentId"]').inputValue();
      const key = await dialog.locator('input[name="idempotencyKey"]').inputValue();
      const warning = kind === "payment"
        ? { saved: "Оплата проведена.", warning: "Оплата проведена, но страницу не удалось обновить. Обновите её вручную." }
        : { saved: "Выплата мастеру проведена.", warning: "Выплата проведена, но страницу не удалось обновить. Обновите её вручную." };
      if (!warn) {
        duplicateFinanceResponse = null;
        duplicateFinancePost = true;
        await dialog.getByRole("button", { name: kind === "payment" ? "Провести оплату" : "Провести выплату", exact: true }).click();
        await page.waitForTimeout(1_300);
        if (await dialog.isVisible()) {
          assert.match(await dialog.getByRole("status").innerText(), /Файл этого запроса уже существует|Оплата проведена|Выплата мастеру проведена/i);
          await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
          await dialog.waitFor({ state: "hidden" });
        }
        if (interceptionError) throw interceptionError;
        assert.ok(duplicateFinanceResponse, `Concurrent duplicate ${kind} POST must run`);
        assert.equal(duplicateFinanceResponse.status, 200);
        assert.match(duplicateFinanceResponse.body, /Файл этого запроса уже существует|Оплата проведена|Выплата мастеру проведена/i);
      } else {
        await submit(dialog, kind === "payment" ? "Провести оплату" : "Провести выплату", warn ? warning : null, `${kind}-warning.png`);
      }
      const table = kind === "payment" ? "order_payments" : "order_master_payouts";
      const records = await sql`SELECT receipt_document_id, amount_minor FROM ${sql(table)}
        WHERE organization_id = ${member.organization_id} AND idempotency_key = ${key}`;
      assert.equal(records.length, 1);
      assert.equal(records[0].receipt_document_id, receiptId);
      assert.equal(Number(records[0].amount_minor), 10000);
      await verifyVersion(receiptId, 1, receiptBytes);
      if (!warn) {
        assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${receiptId}`)[0].count, 1);
        console.log(`concurrent ${kind}: two identical requests left one ledger entry and one receipt version.`);
      }
      console.log(`${suffix}: ${kind} receipt, ledger amount, download and dialog behavior verified.`);
    }

    await page.goto(`${baseUrl}/settings`);
    await page.getByRole("tab", { name: "Шаблоны документов", exact: true }).click();
    await page.getByRole("button", { name: "Добавить шаблон", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Шаблон закрывающего акта", exact: true });
    await dialog.locator('input[name="title"]').fill(`Template ${suffix}`);
    await dialog.locator('input[name="file"]').setInputFiles({ name: "template.pdf", mimeType: "application/pdf", buffer: documentBytes });
    const templateId = await dialog.locator('input[name="idempotencyKey"]').inputValue();
    if (!warn) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
      await dialog.locator('textarea[name="description"]').fill("Template retry after overload");
      await withProcessingSlotsHeld(async () => {
        await dialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
        await dialog.getByRole("status").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
        assert.equal(await dialog.locator('input[name="idempotencyKey"]').inputValue(), templateId);
        assert.equal(await dialog.locator('input[name="title"]').inputValue(), `Template ${suffix}`);
        assert.equal(await dialog.locator('textarea[name="description"]').inputValue(), "Template retry after overload");
        assert.equal(await dialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "template.pdf");
      });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_templates WHERE id = ${templateId}`)[0].count, 0);
    }
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/settings";
      await dialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("status").innerText(), /Эта загрузка ещё обрабатывается|Шаблон уже загружен|Шаблон акта опубликован/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate template POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Эта загрузка ещё обрабатывается|Шаблон уже загружен|Шаблон акта опубликован/i);
    } else {
      await submit(dialog, "Опубликовать шаблон", { saved: "Шаблон акта опубликован.", warning: "Шаблон опубликован, но страницу не удалось обновить. Обновите её вручную." }, "template-warning.png");
    }
    await verifyStoredReference("document_template_versions", "template_id", templateId, documentBytes);
    if (!warn) {
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_template_versions WHERE template_id = ${templateId}`)[0].count, 1);
      console.log("concurrent template: two identical requests published one template version with matching bytes.");
    }
    const templateDownload = await archiveClient.get(`${baseUrl}/api/v1/document-templates/${templateId}/download`);
    assert.equal(templateDownload.status(), 200);
    assert.deepEqual(await templateDownload.body(), documentBytes);

    const [channel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, created_by)
      VALUES (${member.organization_id}, ${`Upload ${suffix}`}, 'group', 'office', ${member.id}) RETURNING id`;
    await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
      VALUES (${member.organization_id}, ${channel.id}, ${member.id}, 'owner', ${member.id})`;
    await page.goto(`${baseUrl}/chat?channel=${channel.id}`);
    await page.locator('textarea[name="body"]').fill(`Attachment ${suffix}`);
    await page.locator('input[name="file"]').setInputFiles({ name: "attachment.pdf", mimeType: "application/pdf", buffer: documentBytes });
    const messageId = await page.locator('input[name="idempotencyKey"]').inputValue();
    if (!warn) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation IN ('chat_message', 'chat_upload')`;
      await withProcessingSlotsHeld(async () => {
        await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
        await page.getByRole("alert").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
        assert.equal(await page.locator('input[name="idempotencyKey"]').inputValue(), messageId);
        assert.equal(await page.locator('textarea[name="body"]').inputValue(), `Attachment ${suffix}`);
        assert.equal(await page.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "attachment.pdf");
      });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${messageId}`)[0].count, 0);
    }
    const messageWarning = "Сообщение отправлено, но переписку не удалось обновить. Обновите страницу вручную.";
    warningResponse = warn ? { saved: null, warning: messageWarning } : null;
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/chat";
    }
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    if (!warn) {
      await page.waitForTimeout(1_300);
      if (await page.locator('input[name="idempotencyKey"]').inputValue() === messageId) {
        await page.getByRole("alert").filter({ hasText: "Вложение ещё обрабатывается" }).waitFor();
        assert.equal(await page.locator('textarea[name="body"]').inputValue(), `Attachment ${suffix}`);
        assert.equal(await page.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "attachment.pdf");
        await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate chat-attachment POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Вложение ещё обрабатывается|"status":"success"/i);
    }
    await page.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, messageId);
    assert.equal(await page.locator('textarea[name="body"]').inputValue(), "");
    assert.equal(await page.locator('input[name="file"]').inputValue(), "");
    if (warn) {
      await page.getByRole("status").filter({ hasText: messageWarning }).waitFor();
      await page.screenshot({ path: join(artifacts, "chat-send-warning.png") });
    }
    await verifyStoredReference("chat_message_attachments", "message_id", messageId, documentBytes);
    if (!warn) {
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${messageId}`)[0].count, 1);
      console.log("concurrent chat attachment: two identical requests left one message and one matching file.");
    }
    await page.getByRole("button", { name: "Настройки группы", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Настройки группы", exact: true });
    await dialog.locator('input[name="avatar"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: imageBytes });
    if (!warn) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation IN ('chat_upload', 'chat_action')`;
      await dialog.locator('input[name="name"]').fill("Upload normal updated");
      await dialog.locator('textarea[name="description"]').fill("Avatar retry after overload");
      await withProcessingSlotsHeld(async () => {
        await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
        await dialog.getByRole("status").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
        assert.equal(await dialog.locator('input[name="name"]').inputValue(), "Upload normal updated");
        assert.equal(await dialog.locator('textarea[name="description"]').inputValue(), "Avatar retry after overload");
        assert.equal(await dialog.locator('input[name="avatar"]').evaluate((input) => input.files?.[0]?.name), "avatar.png");
      });
      const [unchangedChannel] = await sql`SELECT name, description FROM chat_channels WHERE id = ${channel.id}`;
      assert.equal(unchangedChannel.name, "Upload normal");
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_channel_avatars WHERE channel_id = ${channel.id}`)[0].count, 0);
    }
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/chat";
      await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("status").innerText(), /Фото группы уже обрабатывается|Настройки уже изменились|Настройки группы (уже )?сохранены/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate chat-avatar POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Фото группы уже обрабатывается|Настройки уже изменились|Настройки группы (уже )?сохранены/i);
    } else {
      await submit(dialog, "Сохранить", { saved: "Настройки группы сохранены.", warning: "Настройки группы сохранены, но страницу не удалось обновить. Обновите её вручную." }, "avatar-warning.png");
    }
    await verifyStoredReference("chat_channel_avatars", "channel_id", channel.id, imageBytes);
    if (!warn) {
      const [updatedChannel] = await sql`SELECT name, description, version FROM chat_channels WHERE id = ${channel.id}`;
      assert.deepEqual(updatedChannel, { name: "Upload normal updated", description: "Avatar retry after overload", version: 2 });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_channel_avatars WHERE channel_id = ${channel.id}`)[0].count, 1);
      console.log("concurrent group photo: two identical updates left one channel version and one matching avatar.");
    }
    const avatarDownload = await archiveClient.get(`${baseUrl}/api/v1/chat/channels/${channel.id}/avatar`);
    assert.equal(avatarDownload.status(), 200);
    assert.deepEqual(await avatarDownload.body(), imageBytes);
    if (!warn) console.log("processing slots: template, chat attachment and group photo retained their files and fields; retries persisted once.");
    if (!warn) {
      const audioBytes = await readFile(new URL("../src/server/file-scan/fixtures/tone.wav", import.meta.url));
      await page.locator('textarea[name="body"]').fill("Readable audio");
      await page.locator('input[name="file"]').setInputFiles({ name: "voice.wav", mimeType: "audio/wav", buffer: audioBytes });
      const audioMessageId = await page.locator('input[name="idempotencyKey"]').inputValue();
      await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
      await page.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, audioMessageId);
      await verifyStoredReference("chat_message_attachments", "message_id", audioMessageId, audioBytes);

      await page.locator('textarea[name="body"]').fill("Corrupt audio");
      await page.locator('input[name="file"]').setInputFiles({ name: "corrupt.wav", mimeType: "audio/wav", buffer: audioBytes.subarray(0, 12) });
      const corruptAudioId = await page.locator('input[name="idempotencyKey"]').inputValue();
      await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
      await page.getByText("Аудиофайл повреждён или не содержит читаемой записи.", { exact: true }).waitFor();
      assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${corruptAudioId}`)[0].count, 0);
      if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(corruptAudioId)));
      console.log("audio metadata: valid WAV persisted; bare RIFF header rejected before file and database writes.");
    }
    console.log(`${suffix}: template, chat attachment and avatar persisted; template/avatar downloads and warning states verified.`);
  }
  if (environment.CRM_FILE_SCAN_MODE === "required") {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const infectedOffice = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/eicar.com": eicar }));
    const expandedOffice = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/document.xml": Buffer.alloc(26 * 1024 * 1024, 65) }));
    const nestedExpandedOffice = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/embedded.zip": zipSync({ "large.bin": Buffer.alloc(26 * 1024 * 1024, 65) }) }));
    assert.ok(expandedOffice.length < 100_000);
    assert.ok(nestedExpandedOffice.length < 100_000);
    for (const [title, filename, bytes, errorText] of [
      ["EICAR test", "eicar.docx", infectedOffice, "Файл не прошёл проверку безопасности."],
      ["Expanded ZIP test", "expanded.docx", expandedOffice, "Содержимое файла не соответствует заявленному типу."],
      ["Nested expanded ZIP test", "nested-expanded.docx", nestedExpandedOffice, "Содержимое файла не соответствует заявленному типу."],
    ]) {
      await page.goto(`${baseUrl}/documents`);
      await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
      await dialog.locator('summary[aria-label="Заказ"]').click();
      await dialog.getByRole("button", { name: /UPLOAD-1/ }).click();
      await dialog.locator('input[name="title"]').fill(title);
      await dialog.locator('input[name="file"]').setInputFiles({ name: filename, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: bytes });
      const rejectedId = await dialog.locator('input[name="idempotencyKey"]').inputValue();
      await dialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
      await dialog.getByRole("status").filter({ hasText: errorText }).waitFor();
      assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${rejectedId}`)[0].count, 0);
      if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(rejectedId)));
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    }
    console.log("scanner: EICAR, oversized Office ZIP and nested ZIP were rejected before file and database writes.");
  }
  await page.goto(`${baseUrl}/documents`);
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const corruptImageDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await corruptImageDialog.locator('summary[aria-label="Заказ"]').click();
  await corruptImageDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await corruptImageDialog.locator('input[name="title"]').fill("Corrupt image test");
  await corruptImageDialog.locator('input[name="file"]').setInputFiles({ name: "corrupt.png", mimeType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) });
  const corruptImageId = await corruptImageDialog.locator('input[name="idempotencyKey"]').inputValue();
  await corruptImageDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await corruptImageDialog.getByRole("status").filter({ hasText: "Изображение повреждено или слишком велико." }).waitFor();
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${corruptImageId}`)[0].count, 0);
  if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(corruptImageId)));
  await corruptImageDialog.getByRole("button", { name: "Отмена", exact: true }).click();
  console.log("image decoder: PNG header without pixels was rejected before file and database writes.");
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const corruptPdfDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await corruptPdfDialog.locator('summary[aria-label="Заказ"]').click();
  await corruptPdfDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await corruptPdfDialog.locator('input[name="title"]').fill("Corrupt PDF test");
  await corruptPdfDialog.locator('input[name="file"]').setInputFiles({ name: "corrupt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  const corruptPdfId = await corruptPdfDialog.locator('input[name="idempotencyKey"]').inputValue();
  await corruptPdfDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await corruptPdfDialog.getByRole("status").filter({ hasText: "PDF-файл повреждён или не содержит читаемых страниц." }).waitFor();
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${corruptPdfId}`)[0].count, 0);
  if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(corruptPdfId)));
  await corruptPdfDialog.getByRole("button", { name: "Отмена", exact: true }).click();
  console.log("PDF parser: header-only PDF was rejected before file and database writes.");
  const [exportSource] = await sql`SELECT id FROM documents WHERE organization_id = ${member.organization_id} ORDER BY created_at LIMIT 1`;
  assert.ok(exportSource);
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation IN ('document_upload', 'document_export')`;
  assert.equal(FILE_PROCESSING_SLOTS, 2, "Browser saturation fixture must acquire every processing slot.");
  const firstSlot = await sql.reserve();
  const secondSlot = await sql.reserve();
  let busyDocumentId;
  try {
    await firstSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
    await secondSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
    const blockedExport = await archiveClient.post(`${baseUrl}/api/v1/documents/export`, {
      headers: { origin: baseUrl }, data: { documentIds: [exportSource.id] },
    });
    assert.equal(blockedExport.status(), 429);
    assert.equal(blockedExport.headers()["retry-after"], "3");
    await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const busyDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
    await busyDialog.locator('summary[aria-label="Заказ"]').click();
    await busyDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await busyDialog.locator('input[name="title"]').fill("Busy upload retry");
    await busyDialog.locator('input[name="file"]').setInputFiles({ name: "busy.pdf", mimeType: "application/pdf", buffer: pdfFixture("busy retry") });
    busyDocumentId = await busyDialog.locator('input[name="idempotencyKey"]').inputValue();
    await busyDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await busyDialog.getByRole("status").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
    assert.equal(await busyDialog.locator('input[name="idempotencyKey"]').inputValue(), busyDocumentId);
    assert.equal(await busyDialog.locator('input[name="title"]').inputValue(), "Busy upload retry");
    assert.equal((await busyDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name)), "busy.pdf");
  } finally {
    await firstSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
    await secondSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
    firstSlot.release();
    secondSlot.release();
  }
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${busyDocumentId}`)[0].count, 0);
  if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(busyDocumentId)));
  const busyRetryDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await busyRetryDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await busyRetryDialog.waitFor({ state: "hidden" });
  await verifyVersion(busyDocumentId, 1, pdfFixture("busy retry"));
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${busyDocumentId}`)[0].count, 1);
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  await page.goto(`${baseUrl}/documents?document=${busyDocumentId}`);
  await page.getByRole("button", { name: "Новая версия", exact: true }).click();
  const busyVersionDialog = page.getByRole("dialog", { name: "Новая версия документа", exact: true });
  await busyVersionDialog.locator('textarea[name="changeNote"]').fill("Retry after processing slots clear");
  await busyVersionDialog.locator('input[name="file"]').setInputFiles({ name: "busy-version.pdf", mimeType: "application/pdf", buffer: pdfFixture("busy version retry") });
  const busyVersionKey = await busyVersionDialog.locator('input[name="idempotencyKey"]').inputValue();
  const versionFirstSlot = await sql.reserve();
  const versionSecondSlot = await sql.reserve();
  try {
    await versionFirstSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
    await versionSecondSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
    await busyVersionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
    await busyVersionDialog.getByRole("status").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
    assert.equal(await busyVersionDialog.locator('input[name="idempotencyKey"]').inputValue(), busyVersionKey);
    assert.equal(await busyVersionDialog.locator('textarea[name="changeNote"]').inputValue(), "Retry after processing slots clear");
    assert.equal(await busyVersionDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "busy-version.pdf");
  } finally {
    await versionFirstSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
    await versionSecondSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
    versionFirstSlot.release();
    versionSecondSlot.release();
  }
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${busyDocumentId}`)[0].count, 1);
  await busyVersionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
  await busyVersionDialog.waitFor({ state: "hidden" });
  await verifyVersion(busyDocumentId, 2, pdfFixture("busy version retry"));
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${busyDocumentId}`)[0].count, 2);
  console.log("processing slots: saturated export returned 429; document and version uploads retained their fields and succeeded after release.");
  for (const kind of ["payment", "payout"]) {
    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    await page.goto(`${baseUrl}/finance`);
    if (kind === "payment") {
      const summary = page.locator("summary").filter({ hasText: "UPLOAD-1" }).first();
      if (await summary.locator("..").getAttribute("open") === null) await summary.click();
      await page.getByRole("button", { name: "Добавить оплату", exact: true }).click();
    } else {
      await page.getByRole("tab", { name: "Мастера", exact: true }).click();
      await page.getByRole("button", { name: "Провести выплату", exact: true }).click();
    }
    const title = kind === "payment" ? "Оплата клиента" : "Выплата мастеру";
    const label = kind === "payment" ? "Провести оплату" : "Провести выплату";
    const financeDialog = page.getByRole("dialog", { name: title, exact: true });
    await financeDialog.locator('input[name="amount"]').fill("100");
    await financeDialog.locator('input[name="reference"]').fill(`Busy ${kind} reference`);
    await financeDialog.locator('textarea[name="note"]').fill(`Busy ${kind} note`);
    const receiptBytes = pdfFixture(`Busy ${kind} receipt`);
    await financeDialog.locator('input[name="receipt"]').setInputFiles({ name: `busy-${kind}.pdf`, mimeType: "application/pdf", buffer: receiptBytes });
    const key = await financeDialog.locator('input[name="idempotencyKey"]').inputValue();
    const receiptId = await financeDialog.locator('input[name="receiptDocumentId"]').inputValue();
    const firstFinanceSlot = await sql.reserve();
    const secondFinanceSlot = await sql.reserve();
    try {
      await firstFinanceSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
      await secondFinanceSlot`SELECT pg_advisory_lock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
      await financeDialog.getByRole("button", { name: label, exact: true }).click();
      await financeDialog.getByRole("status").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
      assert.equal(await financeDialog.locator('input[name="idempotencyKey"]').inputValue(), key);
      assert.equal(await financeDialog.locator('input[name="receiptDocumentId"]').inputValue(), receiptId);
      assert.equal(await financeDialog.locator('input[name="amount"]').inputValue(), "100");
      assert.equal(await financeDialog.locator('input[name="reference"]').inputValue(), `Busy ${kind} reference`);
      assert.equal(await financeDialog.locator('textarea[name="note"]').inputValue(), `Busy ${kind} note`);
      assert.equal(await financeDialog.locator('input[name="receipt"]').evaluate((input) => input.files?.[0]?.name), `busy-${kind}.pdf`);
    } finally {
      await firstFinanceSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 1)`;
      await secondFinanceSlot`SELECT pg_advisory_unlock(${FILE_PROCESSING_LOCK_CLASS}, 2)`;
      firstFinanceSlot.release();
      secondFinanceSlot.release();
    }
    const table = kind === "payment" ? "order_payments" : "order_master_payouts";
    assert.equal((await sql`SELECT count(*)::integer AS count FROM ${sql(table)} WHERE idempotency_key = ${key}`)[0].count, 0);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${receiptId}`)[0].count, 0);
    await financeDialog.getByRole("button", { name: label, exact: true }).click();
    await financeDialog.waitFor({ state: "hidden" });
    const records = await sql`SELECT receipt_document_id, amount_minor FROM ${sql(table)} WHERE idempotency_key = ${key}`;
    assert.equal(records.length, 1);
    assert.equal(records[0].receipt_document_id, receiptId);
    assert.equal(Number(records[0].amount_minor), 10000);
    await verifyVersion(receiptId, 1, receiptBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${receiptId}`)[0].count, 1);
    console.log(`processing slots: ${kind} receipt and form fields survived rejection; retry committed one ledger entry and matching bytes.`);
  }
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  const lostContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const lostPage = await lostContext.newPage();
  const lostPageErrors = [];
  lostPage.on("pageerror", (error) => lostPageErrors.push(error.message));
  let resolveLostRequest;
  let rejectLostRequest;
  const lostRequest = new Promise((resolve, reject) => { resolveLostRequest = resolve; rejectLostRequest = reject; });
  const lostRequestTimeout = setTimeout(() => rejectLostRequest(new Error("Lost-response action was not intercepted")), 30_000);
  let dropLostResponse = true;
  await lostPage.route("**/documents", async (route) => {
    if (!dropLostResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    dropLostResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveLostRequest({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectLostRequest(error); }
  });
  await lostPage.goto(`${baseUrl}/documents`);
  await lostPage.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const lostDialog = lostPage.getByRole("dialog", { name: "Новый документ", exact: true });
  await lostDialog.locator('summary[aria-label="Заказ"]').click();
  await lostDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await lostDialog.locator('input[name="title"]').fill("Lost response upload");
  const lostBytes = pdfFixture("Lost response after commit");
  await lostDialog.locator('input[name="file"]').setInputFiles({ name: "lost-response.pdf", mimeType: "application/pdf", buffer: lostBytes });
  const lostDocumentId = await lostDialog.locator('input[name="idempotencyKey"]').inputValue();
  await lostDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  const lost = await lostRequest;
  clearTimeout(lostRequestTimeout);
  assert.equal(lost.status, 200);
  assert.match(lost.body, /Документ сохранён в архиве/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${lostDocumentId}`)[0].count, 1);
  const replay = await archiveClient.post(`${baseUrl}/documents`, { data: lost.requestBody, headers: lost.requestHeaders });
  assert.equal(replay.status(), 200);
  assert.match(await replay.text(), /Документ уже загружен/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${lostDocumentId}`)[0].count, 1);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostDocumentId}`)[0].count, 1);
  await verifyVersion(lostDocumentId, 1, lostBytes);
  await lostDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте документ в архиве перед повторной отправкой." }).waitFor();
  assert.equal(await lostDialog.locator('input[name="idempotencyKey"]').inputValue(), lostDocumentId);
  assert.equal(await lostDialog.locator('input[name="title"]').inputValue(), "Lost response upload");
  assert.equal(await lostDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-response.pdf");
  assert.equal(await lostPage.locator('[data-nextjs-dialog]').count(), 0);
  assert.deepEqual(lostPageErrors, []);
  await lostPage.screenshot({ path: join(artifacts, "lost-response.png") });
  await lostDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await lostDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostDocumentId}`)[0].count, 1);
  console.log("lost response after commit: form retained file and retry key; replay and UI retry kept one document.");
  await lostContext.close();
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  const abortedContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const abortedPage = await abortedContext.newPage();
  const abortedPageErrors = [];
  abortedPage.on("pageerror", (error) => abortedPageErrors.push(error.message));
  let abortBeforeDispatch = true;
  await abortedPage.route("**/documents", async (route) => {
    if (!abortBeforeDispatch || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    abortBeforeDispatch = false;
    await route.abort("failed");
  });
  await abortedPage.goto(`${baseUrl}/documents`);
  await abortedPage.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const abortedDialog = abortedPage.getByRole("dialog", { name: "Новый документ", exact: true });
  await abortedDialog.locator('summary[aria-label="Заказ"]').click();
  await abortedDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await abortedDialog.locator('input[name="title"]').fill("Aborted before server dispatch");
  const abortedBytes = pdfFixture("Aborted before server dispatch");
  await abortedDialog.locator('input[name="file"]').setInputFiles({ name: "aborted-before.pdf", mimeType: "application/pdf", buffer: abortedBytes });
  const abortedDocumentId = await abortedDialog.locator('input[name="idempotencyKey"]').inputValue();
  await abortedDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await abortedDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте документ в архиве перед повторной отправкой." }).waitFor();
  assert.equal(abortBeforeDispatch, false);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${abortedDocumentId}`)[0].count, 0);
  assert.equal(await abortedDialog.locator('input[name="idempotencyKey"]').inputValue(), abortedDocumentId);
  assert.equal(await abortedDialog.locator('input[name="title"]').inputValue(), "Aborted before server dispatch");
  assert.equal(await abortedDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "aborted-before.pdf");
  if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(abortedDocumentId)));
  assert.deepEqual(abortedPageErrors, []);
  await abortedDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await abortedDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${abortedDocumentId}`)[0].count, 1);
  await verifyVersion(abortedDocumentId, 1, abortedBytes);
  console.log("aborted before dispatch: no document was written; retained form retried to one intact document.");
  await abortedContext.close();

  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  await sql`CREATE TABLE upload_abort_gate (document_id uuid PRIMARY KEY)`;
  await sql.unsafe(`CREATE FUNCTION block_upload_before_commit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM upload_abort_gate WHERE document_id = NEW.document_id) THEN
        PERFORM pg_advisory_xact_lock(927431, 9);
      END IF;
      RETURN NEW;
    END $$`);
  await sql`CREATE TRIGGER block_upload_before_commit BEFORE INSERT ON document_versions
    FOR EACH ROW EXECUTE FUNCTION block_upload_before_commit()`;
  const inFlightContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const inFlightPage = await inFlightContext.newPage();
  const inFlightErrors = [];
  inFlightPage.on("pageerror", (error) => inFlightErrors.push(error.message));
  let abortInFlightRequest;
  const inFlightAbortSignal = new Promise((resolveAbort) => { abortInFlightRequest = resolveAbort; });
  let resolveInFlightAborted;
  const inFlightAborted = new Promise((resolveAbort) => { resolveInFlightAborted = resolveAbort; });
  let inFlightUpstream;
  let abortFirstInFlight = true;
  await inFlightPage.route("**/documents", async (route) => {
    if (!abortFirstInFlight || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    abortFirstInFlight = false;
    inFlightUpstream = route.fetch();
    await inFlightAbortSignal;
    await route.abort("failed");
    resolveInFlightAborted();
    await inFlightUpstream.catch(() => {});
  });
  await inFlightPage.goto(`${baseUrl}/documents`);
  await inFlightPage.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const inFlightDialog = inFlightPage.getByRole("dialog", { name: "Новый документ", exact: true });
  await inFlightDialog.locator('summary[aria-label="Заказ"]').click();
  await inFlightDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await inFlightDialog.locator('input[name="title"]').fill("Aborted while database commit was blocked");
  const inFlightBytes = pdfFixture("Aborted while database commit was blocked");
  await inFlightDialog.locator('input[name="file"]').setInputFiles({ name: "aborted-in-flight.pdf", mimeType: "application/pdf", buffer: inFlightBytes });
  const inFlightId = await inFlightDialog.locator('input[name="idempotencyKey"]').inputValue();
  await sql`INSERT INTO upload_abort_gate (document_id) VALUES (${inFlightId})`;
  const gateConnection = await sql.reserve();
  let gateLocked = false;
  try {
    await gateConnection`SELECT pg_advisory_lock(927431, 9)`;
    gateLocked = true;
    await inFlightDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [activity] = await sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event = 'advisory'
          AND query LIKE '%INSERT INTO document_versions%') AS blocked`;
      if (activity.blocked) { blocked = true; break; }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    assert.ok(blocked, "Upload must reach the database after writing its file, before committing");
    const inFlightStorageKey = `${member.organization_id}/${inFlightId}/v1.pdf`;
    const inFlightStored = objectStorage
      ? await objectStorage.readVerified(inFlightStorageKey, { sizeBytes: inFlightBytes.length, sha256: createHash("sha256").update(inFlightBytes).digest("hex") }, 15 * 1024 * 1024)
      : await readFile(join(directory, inFlightStorageKey));
    assert.deepEqual(inFlightStored, inFlightBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${inFlightId}`)[0].count, 0);
    abortInFlightRequest();
    await inFlightAborted;
    await inFlightDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте документ в архиве перед повторной отправкой." }).waitFor();
    assert.equal(await inFlightDialog.locator('input[name="idempotencyKey"]').inputValue(), inFlightId);
    assert.equal(await inFlightDialog.locator('input[name="title"]').inputValue(), "Aborted while database commit was blocked");
    assert.equal(await inFlightDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "aborted-in-flight.pdf");
  } finally {
    if (gateLocked) await gateConnection`SELECT pg_advisory_unlock(927431, 9)`;
    gateConnection.release();
  }
  let inFlightCommitted = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await sql`SELECT EXISTS (SELECT 1 FROM documents WHERE id = ${inFlightId}) AS committed`;
    if (row.committed) { inFlightCommitted = true; break; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  assert.ok(inFlightCommitted, "Server must complete the already-started transaction after browser disconnect");
  assert.deepEqual(inFlightErrors, []);
  await verifyVersion(inFlightId, 1, inFlightBytes);
  await inFlightDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await inFlightDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${inFlightId}`)[0].count, 1);
  console.log("aborted in flight before commit: browser lost the response while the database was blocked; server committed once and retained the file for an idempotent retry.");
  await inFlightContext.close();
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  const versionContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const versionPage = await versionContext.newPage();
  const versionPageErrors = [];
  versionPage.on("pageerror", (error) => versionPageErrors.push(error.message));
  let resolveVersionResponse;
  let rejectVersionResponse;
  const versionResponse = new Promise((resolve, reject) => { resolveVersionResponse = resolve; rejectVersionResponse = reject; });
  const versionTimeout = setTimeout(() => rejectVersionResponse(new Error("Lost version response was not intercepted")), 30_000);
  let dropVersionResponse = true;
  await versionPage.route("**/documents**", async (route) => {
    if (!dropVersionResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    dropVersionResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveVersionResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectVersionResponse(error); }
  });
  await versionPage.goto(`${baseUrl}/documents?document=${lostDocumentId}`);
  await versionPage.getByRole("button", { name: "Новая версия", exact: true }).click();
  const versionDialog = versionPage.getByRole("dialog", { name: "Новая версия документа", exact: true });
  await versionDialog.locator('textarea[name="changeNote"]').fill("Lost response version note");
  const lostVersionBytes = pdfFixture("Lost document version response after commit");
  await versionDialog.locator('input[name="file"]').setInputFiles({ name: "lost-version.pdf", mimeType: "application/pdf", buffer: lostVersionBytes });
  const versionKey = await versionDialog.locator('input[name="idempotencyKey"]').inputValue();
  await versionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
  const lostVersion = await versionResponse;
  clearTimeout(versionTimeout);
  assert.equal(lostVersion.status, 200);
  assert.match(lostVersion.body, /Версия 2 сохранена/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostDocumentId}`)[0].count, 2);
  await versionDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте историю документа перед повторной отправкой." }).waitFor();
  assert.equal(await versionDialog.locator('input[name="idempotencyKey"]').inputValue(), versionKey);
  assert.equal(await versionDialog.locator('textarea[name="changeNote"]').inputValue(), "Lost response version note");
  assert.equal(await versionDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-version.pdf");
  assert.equal(await versionPage.locator('[data-nextjs-dialog]').count(), 0);
  assert.deepEqual(versionPageErrors, []);
  await versionPage.screenshot({ path: join(artifacts, "version-lost-response.png") });
  const versionReplay = await archiveClient.post(`${baseUrl}/documents`, { data: lostVersion.requestBody, headers: lostVersion.requestHeaders });
  assert.equal(versionReplay.status(), 200);
  assert.match(await versionReplay.text(), /Эта версия уже загружена/);
  await versionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
  await versionDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostDocumentId}`)[0].count, 2);
  await verifyVersion(lostDocumentId, 1, lostBytes);
  await verifyVersion(lostDocumentId, 2, lostVersionBytes);
  console.log("lost version response after commit: form retained note, file and retry key; replay and UI retry kept two intact versions.");
  await versionContext.close();
  for (const kind of ["payment", "payout"]) {
    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    const financeContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
    const financePage = await financeContext.newPage();
    const financePageErrors = [];
    financePage.on("pageerror", (error) => financePageErrors.push(error.message));
    let resolveFinanceResponse;
    let rejectFinanceResponse;
    const financeResponse = new Promise((resolve, reject) => { resolveFinanceResponse = resolve; rejectFinanceResponse = reject; });
    const financeTimeout = setTimeout(() => rejectFinanceResponse(new Error(`Lost ${kind} response was not intercepted`)), 30_000);
    let dropFinanceResponse = true;
    await financePage.route("**/finance", async (route) => {
      if (!dropFinanceResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
      dropFinanceResponse = false;
      try {
        const requestHeaders = route.request().headers();
        const requestBody = route.request().postDataBuffer();
        const response = await route.fetch();
        resolveFinanceResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
        await route.abort("failed");
      } catch (error) { rejectFinanceResponse(error); }
    });
    await financePage.goto(`${baseUrl}/finance`);
    if (kind === "payment") {
      const summary = financePage.locator("summary").filter({ hasText: "UPLOAD-1" }).first();
      if (await summary.locator("..").getAttribute("open") === null) await summary.click();
      await financePage.getByRole("button", { name: "Добавить оплату", exact: true }).click();
    } else {
      await financePage.getByRole("tab", { name: "Мастера", exact: true }).click();
      await financePage.getByRole("button", { name: "Провести выплату", exact: true }).click();
    }
    const title = kind === "payment" ? "Оплата клиента" : "Выплата мастеру";
    const label = kind === "payment" ? "Провести оплату" : "Провести выплату";
    const historyLabel = kind === "payment" ? "оплат" : "выплат";
    const financeDialog = financePage.getByRole("dialog", { name: title, exact: true });
    await financeDialog.locator('input[name="amount"]').fill("100");
    await financeDialog.locator('input[name="reference"]').fill(`Lost ${kind} reference`);
    await financeDialog.locator('textarea[name="note"]').fill(`Lost ${kind} note`);
    const receiptBytes = pdfFixture(`Lost ${kind} response after commit`);
    await financeDialog.locator('input[name="receipt"]').setInputFiles({ name: `lost-${kind}.pdf`, mimeType: "application/pdf", buffer: receiptBytes });
    const requestKey = await financeDialog.locator('input[name="idempotencyKey"]').inputValue();
    const receiptId = await financeDialog.locator('input[name="receiptDocumentId"]').inputValue();
    await financeDialog.getByRole("button", { name: label, exact: true }).click();
    const lostFinance = await financeResponse;
    clearTimeout(financeTimeout);
    assert.equal(lostFinance.status, 200);
    assert.match(lostFinance.body, kind === "payment" ? /Оплата проведена/ : /Выплата мастеру проведена/);
    const table = kind === "payment" ? "order_payments" : "order_master_payouts";
    assert.equal((await sql`SELECT count(*)::integer AS count FROM ${sql(table)} WHERE idempotency_key = ${requestKey}`)[0].count, 1);
    await financeDialog.getByRole("status").filter({ hasText: `Не удалось получить ответ сервера. Проверьте историю ${historyLabel} перед повторной отправкой.` }).waitFor();
    assert.equal(await financeDialog.locator('input[name="idempotencyKey"]').inputValue(), requestKey);
    assert.equal(await financeDialog.locator('input[name="receiptDocumentId"]').inputValue(), receiptId);
    assert.equal(await financeDialog.locator('input[name="amount"]').inputValue(), "100");
    assert.equal(await financeDialog.locator('input[name="reference"]').inputValue(), `Lost ${kind} reference`);
    assert.equal(await financeDialog.locator('textarea[name="note"]').inputValue(), `Lost ${kind} note`);
    assert.equal(await financeDialog.locator('input[name="receipt"]').evaluate((input) => input.files?.[0]?.name), `lost-${kind}.pdf`);
    assert.deepEqual(financePageErrors, []);
    await financePage.screenshot({ path: join(artifacts, `${kind}-lost-response.png`) });
    const replay = await archiveClient.post(`${baseUrl}/finance`, { data: lostFinance.requestBody, headers: lostFinance.requestHeaders });
    assert.equal(replay.status(), 200);
    assert.match(await replay.text(), kind === "payment" ? /Оплата проведена/ : /Выплата мастеру проведена/);
    await financeDialog.getByRole("button", { name: label, exact: true }).click();
    await financeDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT count(*)::integer AS count FROM ${sql(table)} WHERE idempotency_key = ${requestKey}`)[0].count, 1);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${receiptId}`)[0].count, 1);
    await verifyVersion(receiptId, 1, receiptBytes);
    console.log(`lost ${kind} response after commit: form retained receipt and fields; replay and UI retry left one ledger entry.`);
    await financeContext.close();
  }
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  const templateContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const templatePage = await templateContext.newPage();
  const templatePageErrors = [];
  templatePage.on("pageerror", (error) => templatePageErrors.push(error.message));
  let resolveTemplateResponse;
  let rejectTemplateResponse;
  const templateResponse = new Promise((resolve, reject) => { resolveTemplateResponse = resolve; rejectTemplateResponse = reject; });
  const templateTimeout = setTimeout(() => rejectTemplateResponse(new Error("Lost template response was not intercepted")), 30_000);
  let dropTemplateResponse = true;
  await templatePage.route("**/settings**", async (route) => {
    if (!dropTemplateResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
    dropTemplateResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveTemplateResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectTemplateResponse(error); }
  });
  await templatePage.goto(`${baseUrl}/settings`);
  await templatePage.getByRole("tab", { name: "Шаблоны документов", exact: true }).click();
  await templatePage.getByRole("button", { name: "Добавить шаблон", exact: true }).click();
  const templateDialog = templatePage.getByRole("dialog", { name: "Шаблон закрывающего акта", exact: true });
  await templateDialog.locator('input[name="title"]').fill("Lost response template");
  await templateDialog.locator('textarea[name="description"]').fill("Description retained after lost response");
  const lostTemplateBytes = pdfFixture("Lost template response after commit");
  await templateDialog.locator('input[name="file"]').setInputFiles({ name: "lost-template.pdf", mimeType: "application/pdf", buffer: lostTemplateBytes });
  const lostTemplateId = await templateDialog.locator('input[name="idempotencyKey"]').inputValue();
  await templateDialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
  const lostTemplate = await templateResponse;
  clearTimeout(templateTimeout);
  assert.equal(lostTemplate.status, 200);
  assert.match(lostTemplate.body, /Шаблон акта опубликован/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_templates WHERE id = ${lostTemplateId}`)[0].count, 1);
  await templateDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте список шаблонов перед повторной отправкой." }).waitFor();
  assert.equal(await templateDialog.locator('input[name="idempotencyKey"]').inputValue(), lostTemplateId);
  assert.equal(await templateDialog.locator('input[name="title"]').inputValue(), "Lost response template");
  assert.equal(await templateDialog.locator('textarea[name="description"]').inputValue(), "Description retained after lost response");
  assert.equal(await templateDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-template.pdf");
  assert.equal(await templatePage.locator('[data-nextjs-dialog]').count(), 0);
  assert.deepEqual(templatePageErrors, []);
  await templatePage.screenshot({ path: join(artifacts, "template-lost-response.png") });
  const templateReplay = await archiveClient.post(`${baseUrl}/settings`, { data: lostTemplate.requestBody, headers: lostTemplate.requestHeaders });
  assert.equal(templateReplay.status(), 200);
  assert.match(await templateReplay.text(), /Шаблон уже загружен/);
  await templateDialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
  await templateDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_template_versions WHERE template_id = ${lostTemplateId}`)[0].count, 1);
  await verifyStoredReference("document_template_versions", "template_id", lostTemplateId, lostTemplateBytes);
  console.log("lost template response after commit: form retained title, description, file and retry key; replay and UI retry kept one template version.");
  await templateContext.close();
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation IN ('chat_message', 'chat_upload')`;
  const [lostChatChannel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, created_by)
    VALUES (${member.organization_id}, 'Lost attachment response', 'group', 'office', ${member.id}) RETURNING id`;
  await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
    VALUES (${member.organization_id}, ${lostChatChannel.id}, ${member.id}, 'owner', ${member.id})`;
  const chatContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const chatPage = await chatContext.newPage();
  const chatPageErrors = [];
  chatPage.on("pageerror", (error) => chatPageErrors.push(error.message));
  let resolveChatResponse;
  let rejectChatResponse;
  const chatResponse = new Promise((resolve, reject) => { resolveChatResponse = resolve; rejectChatResponse = reject; });
  const chatTimeout = setTimeout(() => rejectChatResponse(new Error("Lost chat response was not intercepted")), 30_000);
  let dropChatResponse = true;
  let lostMessageId = null;
  await chatPage.route("**/chat**", async (route) => {
    if (!dropChatResponse || !lostMessageId || route.request().method() !== "POST" || !route.request().headers()["next-action"] || !route.request().postDataBuffer()?.includes(lostMessageId)) return route.continue();
    dropChatResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveChatResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectChatResponse(error); }
  });
  await chatPage.goto(`${baseUrl}/chat?channel=${lostChatChannel.id}`);
  await chatPage.locator('textarea[name="body"]').fill("Message retained after lost response");
  const lostChatBytes = pdfFixture("Lost chat attachment response after commit");
  await chatPage.locator('input[name="file"]').setInputFiles({ name: "lost-attachment.pdf", mimeType: "application/pdf", buffer: lostChatBytes });
  lostMessageId = await chatPage.locator('input[name="idempotencyKey"]').inputValue();
  await chatPage.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  const lostChat = await chatResponse;
  clearTimeout(chatTimeout);
  assert.equal(lostChat.status, 200);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${lostMessageId}`)[0].count, 1);
  await chatPage.getByRole("alert").filter({ hasText: "Не удалось получить ответ сервера. Проверьте переписку перед повторной отправкой." }).waitFor();
  assert.equal(await chatPage.locator('input[name="idempotencyKey"]').inputValue(), lostMessageId);
  assert.equal(await chatPage.locator('textarea[name="body"]').inputValue(), "Message retained after lost response");
  assert.equal(await chatPage.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-attachment.pdf");
  assert.equal(await chatPage.locator('[data-nextjs-dialog]').count(), 0);
  assert.deepEqual(chatPageErrors, []);
  await chatPage.screenshot({ path: join(artifacts, "chat-lost-response.png") });
  const chatReplay = await archiveClient.post(`${baseUrl}/chat?channel=${lostChatChannel.id}`, { data: lostChat.requestBody, headers: lostChat.requestHeaders });
  assert.equal(chatReplay.status(), 200);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${lostMessageId}`)[0].count, 1);
  await chatPage.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await chatPage.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, lostMessageId);
  assert.equal(await chatPage.locator('textarea[name="body"]').inputValue(), "");
  assert.equal(await chatPage.locator('input[name="file"]').inputValue(), "");
  assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${lostMessageId}`)[0].count, 1);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_message_attachments WHERE message_id = ${lostMessageId}`)[0].count, 1);
  await verifyStoredReference("chat_message_attachments", "message_id", lostMessageId, lostChatBytes);
  console.log("lost chat response after commit: draft and attachment survived; replay and UI retry kept one message and file.");
  await chatContext.close();
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation IN ('chat_action', 'chat_upload')`;
  const [lostAvatarChannel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, created_by)
    VALUES (${member.organization_id}, 'Lost avatar group', 'group', 'office', ${member.id}) RETURNING id`;
  await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
    VALUES (${member.organization_id}, ${lostAvatarChannel.id}, ${member.id}, 'owner', ${member.id})`;
  const avatarContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const avatarPage = await avatarContext.newPage();
  const avatarPageErrors = [];
  avatarPage.on("pageerror", (error) => avatarPageErrors.push(error.message));
  await avatarPage.goto(`${baseUrl}/chat?channel=${lostAvatarChannel.id}`);
  await avatarPage.getByRole("button", { name: "Настройки группы", exact: true }).click();
  const avatarDialog = avatarPage.getByRole("dialog", { name: "Настройки группы", exact: true });
  await avatarDialog.locator('input[name="name"]').fill("Lost avatar group updated");
  await avatarDialog.locator('textarea[name="description"]').fill("Description retained after lost avatar response");
  await avatarDialog.locator('input[name="avatar"]').setInputFiles({ name: "lost-avatar.png", mimeType: "image/png", buffer: imageBytes });
  let resolveAvatarResponse;
  let rejectAvatarResponse;
  const avatarResponse = new Promise((resolve, reject) => { resolveAvatarResponse = resolve; rejectAvatarResponse = reject; });
  const avatarTimeout = setTimeout(() => rejectAvatarResponse(new Error("Lost avatar response was not intercepted")), 30_000);
  let dropAvatarResponse = true;
  await avatarPage.route("**/chat**", async (route) => {
    if (!dropAvatarResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"] || !route.request().postDataBuffer()?.includes("Lost avatar group updated")) return route.continue();
    dropAvatarResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveAvatarResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectAvatarResponse(error); }
  });
  await avatarDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  const lostAvatar = await avatarResponse;
  clearTimeout(avatarTimeout);
  assert.equal(lostAvatar.status, 200);
  assert.match(lostAvatar.body, /Настройки группы сохранены/);
  assert.deepEqual((await sql`SELECT name, description, version FROM chat_channels WHERE id = ${lostAvatarChannel.id}`)[0], {
    name: "Lost avatar group updated", description: "Description retained after lost avatar response", version: 2,
  });
  await avatarDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте настройки группы перед повторной отправкой." }).waitFor();
  assert.equal(await avatarDialog.locator('input[name="name"]').inputValue(), "Lost avatar group updated");
  assert.equal(await avatarDialog.locator('textarea[name="description"]').inputValue(), "Description retained after lost avatar response");
  assert.equal(await avatarDialog.locator('input[name="avatar"]').evaluate((input) => input.files?.[0]?.name), "lost-avatar.png");
  assert.equal(await avatarPage.locator('[data-nextjs-dialog]').count(), 0);
  assert.deepEqual(avatarPageErrors, []);
  await avatarPage.screenshot({ path: join(artifacts, "avatar-lost-response.png") });
  const avatarReplay = await archiveClient.post(`${baseUrl}/chat?channel=${lostAvatarChannel.id}`, { data: lostAvatar.requestBody, headers: lostAvatar.requestHeaders });
  assert.equal(avatarReplay.status(), 200);
  assert.match(await avatarReplay.text(), /Настройки группы уже сохранены/);
  await avatarDialog.locator('input[name="name"]').fill("Different group settings");
  await avatarDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await avatarDialog.getByRole("status").filter({ hasText: "Настройки уже изменились. Обновите страницу." }).waitFor();
  assert.equal((await sql`SELECT version FROM chat_channels WHERE id = ${lostAvatarChannel.id}`)[0].version, 2);
  await avatarDialog.locator('input[name="name"]').fill("Lost avatar group updated");
  await avatarDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await avatarDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT version FROM chat_channels WHERE id = ${lostAvatarChannel.id}`)[0].version, 2);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_channel_avatars WHERE channel_id = ${lostAvatarChannel.id}`)[0].count, 1);
  await verifyStoredReference("chat_channel_avatars", "channel_id", lostAvatarChannel.id, imageBytes);
  console.log("lost avatar response after commit: form retained photo and settings; replay and UI retry recognized the saved avatar without replacing it.");
  await avatarContext.close();
  // A file at the accepted 15 MiB boundary used to be truncated by Next's
  // default 10 MiB proxy buffer before the upload action could validate it.
  const boundaryBytes = pdfFixture("15 MiB boundary", 15 * 1024 * 1024);
  await page.goto(`${baseUrl}/documents`);
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const boundaryDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
  await boundaryDialog.locator('summary[aria-label="Заказ"]').click();
  await boundaryDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
  await boundaryDialog.locator('input[name="title"]').fill("PDF на границе лимита");
  await boundaryDialog.locator('input[name="file"]').setInputFiles({ name: "boundary.pdf", mimeType: "application/pdf", buffer: boundaryBytes });
  const boundaryDocumentId = await boundaryDialog.locator('input[name="idempotencyKey"]').inputValue();
  await submit(boundaryDialog, "Загрузить документ", null, "boundary-upload.png");
  await verifyVersion(boundaryDocumentId, 1, boundaryBytes);
  console.log("boundary: 15 MiB document crossed the proxy and Server Action without truncation.");
  const [{ count: versionsBeforePause }] = await sql`SELECT count(*)::integer AS count FROM document_versions`;
  const localEntriesBeforePause = objectStorage ? null : (await readdir(directory, { recursive: true })).sort();
  assert.equal((await setFileWriteMode({ databaseUrl: environment.DATABASE_URL, mode: "pause" })).drained, true);
  try {
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const pausedDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
    await pausedDialog.locator('summary[aria-label="Заказ"]').click();
    await pausedDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await pausedDialog.locator('input[name="title"]').fill("Paused upload must not persist");
    await pausedDialog.locator('input[name="file"]').setInputFiles({
      name: "paused.pdf", mimeType: "application/pdf", buffer: pdfFixture("Paused upload"),
    });
    await pausedDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await pausedDialog.getByRole("status").filter({ hasText: "Загрузка файлов временно остановлена" }).waitFor();
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions`)[0].count, versionsBeforePause);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations`)[0].count, 0);
    if (localEntriesBeforePause) assert.deepEqual((await readdir(directory, { recursive: true })).sort(), localEntriesBeforePause);
    console.log("Paused browser upload showed a clear message without a file or database reference.");
  } finally {
    await setFileWriteMode({ databaseUrl: environment.DATABASE_URL, mode: "resume" });
  }
  const masterPassword = randomBytes(32).toString("hex");
  const createMaster = spawnSync(process.execPath, ["scripts/create-member.ts"], { env: {
    ...environment, AUTH_MEMBER_ORGANIZATION_ID: member.organization_id, AUTH_MEMBER_NAME: "Upload master",
    AUTH_MEMBER_EMAIL: "master@example.invalid", AUTH_MEMBER_PASSWORD: masterPassword,
    AUTH_MEMBER_ROLE: "master", AUTH_MEMBER_MASTER_ID: master.id,
  }, encoding: "utf8" });
  assert.equal(createMaster.status, 0, createMaster.stderr);
  await page.context().clearCookies();
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill("master@example.invalid");
  await page.getByPlaceholder("Пароль").fill(masterPassword);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/my-visits");
  for (const warn of [false, true]) {
    await page.setViewportSize(warn ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const [visit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id, assigned_master_id,
      scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot, object_address_snapshot)
      VALUES (${member.organization_id}, ${order.id}, ${object.id}, ${master.id},
        (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + (${warn ? 12 : 10} * interval '1 hour')) AT TIME ZONE 'Europe/Moscow',
        (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + (${warn ? 13 : 11} * interval '1 hour')) AT TIME ZONE 'Europe/Moscow',
        'planned', 'Upload customer', 'Upload object', 'Test address') RETURNING id`;
    await page.goto(`${baseUrl}/my-visits`);
    await page.getByRole("button", { name: "Материалы", exact: true }).last().click();
    let dialog = page.getByRole("dialog", { name: "Материалы выезда", exact: true });
    await dialog.locator('input[name="file"]').setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: imageBytes });
    const evidenceId = await dialog.locator('input[name="idempotencyKey"]').inputValue();
    if (!warn) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
      await dialog.locator('textarea[name="note"]').fill("Photo retry after overload");
      await withProcessingSlotsHeld(async () => {
        await dialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
        assert.equal(await dialog.locator('input[name="idempotencyKey"]').inputValue(), evidenceId);
        assert.equal(await dialog.locator('textarea[name="note"]').inputValue(), "Photo retry after overload");
        assert.equal(await dialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "evidence.png");
      });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${evidenceId}`)[0].count, 0);
    }
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/my-visits";
      await dialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("alert").innerText(), /Эта загрузка ещё обрабатывается|Этот материал уже сохранён|Материал сохранён в документах заказа/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate visit-photo POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Эта загрузка ещё обрабатывается|Этот материал уже сохранён|Материал сохранён в документах заказа/i);
    } else {
      await submit(dialog, "Добавить материал", { saved: "Материал сохранён в документах заказа.", warning: "Материал сохранён, но страницу не удалось обновить. Обновите её вручную." }, "evidence-warning.png");
    }
    await verifyVersion(evidenceId, 1, imageBytes, true);
    if (!warn) assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${evidenceId}`)[0].count, 1);
    await page.getByRole("button", { name: "Завершить", exact: true }).last().click();
    dialog = page.getByRole("dialog", { name: "Завершить выезд", exact: true });
    await dialog.locator('textarea[name="completionNotes"]').fill("Work completed and signed by customer");
    const actBytes = pdfFixture(`Signed act ${warn}`);
    await dialog.locator('input[name="file"]').setInputFiles({ name: "act.pdf", mimeType: "application/pdf", buffer: actBytes });
    const actId = await dialog.locator('input[name="idempotencyKey"]').inputValue();
    if (!warn) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
      await dialog.locator('input[name="actTitle"]').fill("Signed act after overload");
      await withProcessingSlotsHeld(async () => {
        await dialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: "Сервер обрабатывает слишком много файлов. Повторите загрузку через несколько секунд." }).waitFor();
        assert.equal(await dialog.locator('input[name="idempotencyKey"]').inputValue(), actId);
        assert.equal(await dialog.locator('input[name="actTitle"]').inputValue(), "Signed act after overload");
        assert.equal(await dialog.locator('textarea[name="completionNotes"]').inputValue(), "Work completed and signed by customer");
        assert.equal(await dialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "act.pdf");
      });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${actId}`)[0].count, 0);
      const [beforeRetry] = await sql`SELECT status, completion_document_id FROM service_visits WHERE id = ${visit.id}`;
      assert.deepEqual(beforeRetry, { status: "planned", completion_document_id: null });
    }
    if (!warn) {
      duplicateOtherResponse = null;
      duplicateOtherPost = "/my-visits";
      await dialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
      await page.waitForTimeout(1_300);
      if (await dialog.isVisible()) {
        assert.match(await dialog.getByRole("alert").innerText(), /Эта загрузка уже обрабатывается|Выезд уже завершён|Выезд завершён, акт добавлен в архив/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate visit-act POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Эта загрузка уже обрабатывается|Выезд уже завершён|Выезд завершён, акт добавлен в архив/i);
    } else {
      await submit(dialog, "Завершить с актом", { saved: "Выезд завершён, акт добавлен в архив.", warning: "Выезд завершён, акт сохранён, но страницу не удалось обновить. Обновите её вручную." }, "closing-act-warning.png", "Выезд завершён");
    }
    await verifyVersion(actId, 1, actBytes, true);
    if (!warn) assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${actId}`)[0].count, 1);
    const [completed] = await sql`SELECT status, completion_document_id FROM service_visits WHERE id = ${visit.id}`;
    assert.deepEqual(completed, { status: "completed", completion_document_id: actId });
    if (!warn) {
      console.log("processing slots: visit photo and signed act retained their fields; retries wrote one file each and completed the visit once.");
      console.log("concurrent visit uploads: two photo and two act requests left one file each and completed the visit once.");
    }
    console.log(`${warn ? "warning" : "normal"}: master photo and signed act persisted; visit completed.`);
  }
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  const [lostVisit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id, assigned_master_id,
    scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot, object_address_snapshot)
    VALUES (${member.organization_id}, ${order.id}, ${object.id}, ${master.id},
      (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + interval '14 hours') AT TIME ZONE 'Europe/Moscow',
      (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + interval '15 hours') AT TIME ZONE 'Europe/Moscow',
      'planned', 'Upload customer', 'Upload object', 'Test address') RETURNING id`;
  const masterContext = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1440, height: 1000 } });
  const masterPage = await masterContext.newPage();
  const masterPageErrors = [];
  masterPage.on("pageerror", (error) => masterPageErrors.push(error.message));
  const masterClient = await request.newContext({ storageState: await page.context().storageState() });
  await masterPage.goto(`${baseUrl}/my-visits`);
  await masterPage.getByRole("button", { name: "Материалы", exact: true }).last().click();
  const lostEvidenceDialog = masterPage.getByRole("dialog", { name: "Материалы выезда", exact: true });
  assert.equal(await lostEvidenceDialog.locator('input[name="visitId"]').inputValue(), lostVisit.id);
  await lostEvidenceDialog.locator('textarea[name="note"]').fill("Lost visit photo note");
  await lostEvidenceDialog.locator('input[name="file"]').setInputFiles({ name: "lost-evidence.png", mimeType: "image/png", buffer: imageBytes });
  const lostEvidenceId = await lostEvidenceDialog.locator('input[name="idempotencyKey"]').inputValue();
  let resolveEvidenceResponse;
  let rejectEvidenceResponse;
  const evidenceResponse = new Promise((resolve, reject) => { resolveEvidenceResponse = resolve; rejectEvidenceResponse = reject; });
  const evidenceTimeout = setTimeout(() => rejectEvidenceResponse(new Error("Lost evidence response was not intercepted")), 30_000);
  let dropEvidenceResponse = true;
  await masterPage.route("**/my-visits**", async (route) => {
    if (!dropEvidenceResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"] || !route.request().postDataBuffer()?.includes(lostEvidenceId)) return route.continue();
    dropEvidenceResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveEvidenceResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectEvidenceResponse(error); }
  });
  await lostEvidenceDialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
  const lostEvidence = await evidenceResponse;
  clearTimeout(evidenceTimeout);
  assert.equal(lostEvidence.status, 200);
  assert.match(lostEvidence.body, /Материал сохранён в документах заказа/);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${lostEvidenceId}`)[0].count, 1);
  await lostEvidenceDialog.getByRole("alert").filter({ hasText: "Не удалось получить ответ сервера. Проверьте материалы выезда перед повторной отправкой." }).waitFor();
  assert.equal(await lostEvidenceDialog.locator('input[name="idempotencyKey"]').inputValue(), lostEvidenceId);
  assert.equal(await lostEvidenceDialog.locator('textarea[name="note"]').inputValue(), "Lost visit photo note");
  assert.equal(await lostEvidenceDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-evidence.png");
  assert.deepEqual(masterPageErrors, []);
  await masterPage.screenshot({ path: join(artifacts, "visit-photo-lost-response.png") });
  const evidenceReplay = await masterClient.post(`${baseUrl}/my-visits`, { data: lostEvidence.requestBody, headers: lostEvidence.requestHeaders });
  assert.equal(evidenceReplay.status(), 200);
  assert.match(await evidenceReplay.text(), /Этот материал уже сохранён/);
  await lostEvidenceDialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
  await lostEvidenceDialog.waitFor({ state: "hidden" });
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostEvidenceId}`)[0].count, 1);
  await verifyVersion(lostEvidenceId, 1, imageBytes, true);
  console.log("lost visit photo response after commit: form retained note and file; replay and UI retry kept one document.");
  await masterPage.unroute("**/my-visits**");
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
  await masterPage.goto(`${baseUrl}/my-visits`);
  await masterPage.getByRole("button", { name: "Завершить", exact: true }).last().click();
  const lostActDialog = masterPage.getByRole("dialog", { name: "Завершить выезд", exact: true });
  assert.equal(await lostActDialog.locator('input[name="visitId"]').inputValue(), lostVisit.id);
  await lostActDialog.locator('input[name="actTitle"]').fill("Lost response signed act");
  await lostActDialog.locator('textarea[name="completionNotes"]').fill("Work completed before response was lost");
  const lostActBytes = pdfFixture("Lost signed act response after commit");
  await lostActDialog.locator('input[name="file"]').setInputFiles({ name: "lost-act.pdf", mimeType: "application/pdf", buffer: lostActBytes });
  const lostActId = await lostActDialog.locator('input[name="idempotencyKey"]').inputValue();
  let resolveActResponse;
  let rejectActResponse;
  const actResponse = new Promise((resolve, reject) => { resolveActResponse = resolve; rejectActResponse = reject; });
  const actTimeout = setTimeout(() => rejectActResponse(new Error("Lost act response was not intercepted")), 30_000);
  let dropActResponse = true;
  await masterPage.route("**/my-visits**", async (route) => {
    if (!dropActResponse || route.request().method() !== "POST" || !route.request().headers()["next-action"] || !route.request().postDataBuffer()?.includes(lostActId)) return route.continue();
    dropActResponse = false;
    try {
      const requestHeaders = route.request().headers();
      const requestBody = route.request().postDataBuffer();
      const response = await route.fetch();
      resolveActResponse({ requestHeaders, requestBody, status: response.status(), body: await response.text() });
      await route.abort("failed");
    } catch (error) { rejectActResponse(error); }
  });
  await lostActDialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
  const lostAct = await actResponse;
  clearTimeout(actTimeout);
  assert.equal(lostAct.status, 200);
  assert.match(lostAct.body, /Выезд завершён, акт добавлен в архив/);
  const [visitAfterCommit] = await sql`SELECT status, completion_document_id, version FROM service_visits WHERE id = ${lostVisit.id}`;
  assert.equal(visitAfterCommit.status, "completed");
  assert.equal(visitAfterCommit.completion_document_id, lostActId);
  await lostActDialog.getByRole("alert").filter({ hasText: "Не удалось получить ответ сервера. Проверьте статус выезда и акт перед повторной отправкой." }).waitFor();
  assert.equal(await lostActDialog.locator('input[name="idempotencyKey"]').inputValue(), lostActId);
  assert.equal(await lostActDialog.locator('input[name="actTitle"]').inputValue(), "Lost response signed act");
  assert.equal(await lostActDialog.locator('textarea[name="completionNotes"]').inputValue(), "Work completed before response was lost");
  assert.equal(await lostActDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "lost-act.pdf");
  assert.deepEqual(masterPageErrors, []);
  await masterPage.screenshot({ path: join(artifacts, "signed-act-lost-response.png") });
  const actReplay = await masterClient.post(`${baseUrl}/my-visits`, { data: lostAct.requestBody, headers: lostAct.requestHeaders });
  assert.equal(actReplay.status(), 200);
  assert.match(await actReplay.text(), /Выезд уже завершён, акт сохранён/);
  await lostActDialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
  await lostActDialog.waitFor({ state: "hidden" });
  assert.deepEqual((await sql`SELECT status, completion_document_id, version FROM service_visits WHERE id = ${lostVisit.id}`)[0], visitAfterCommit);
  assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${lostActId}`)[0].count, 1);
  await verifyVersion(lostActId, 1, lostActBytes, true);
  console.log("lost signed act response after commit: form retained fields and file; replay and UI retry completed the visit only once.");
  await masterClient.dispose();
  const masterStorageState = await masterContext.storageState();
  await masterContext.close();
  assert.equal(replaced, 9);
  assert.equal(interceptionError, null);
  assert.deepEqual(browserErrors, []);
  if (stallScanner) {
    await page.context().clearCookies();
    await page.goto(`${baseUrl}/login`);
    await page.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
    await page.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");
    const [existingDocument] = await sql`SELECT id FROM documents WHERE organization_id = ${member.organization_id} ORDER BY created_at LIMIT 1`;
    stallScanner();
    const startedAt = Date.now();
    const stalledReadiness = await fetch(`${baseUrl}/api/v1/system/ready`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(stalledReadiness.status, 503);
    assert.equal((await stalledReadiness.json()).scanner, "unavailable");
    assert.ok(Date.now() - startedAt >= 1_500, "Scanner timeout was not exercised.");
    assert.equal((await archiveClient.get(`${baseUrl}/api/v1/documents/${existingDocument.id}/download`)).status(), 500);
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const stalledDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
    await stalledDialog.locator('summary[aria-label="Заказ"]').click();
    await stalledDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await stalledDialog.locator('input[name="title"]').fill("Scanner timeout test");
    await stalledDialog.locator('input[name="file"]').setInputFiles({ name: "timeout.pdf", mimeType: "application/pdf", buffer: pdfFixture("Timeout test") });
    const stalledId = await stalledDialog.locator('input[name="idempotencyKey"]').inputValue();
    await stalledDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await stalledDialog.getByRole("status").filter({ hasText: "Проверка файла временно недоступна." }).waitFor();
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${stalledId}`)[0].count, 0);
    if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(stalledId)));
    resumeScanner();
    const recoveredReadiness = await fetch(`${baseUrl}/api/v1/system/ready`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(recoveredReadiness.status, 200);
    assert.equal((await recoveredReadiness.json()).scanner, "available");
    assert.equal((await archiveClient.get(`${baseUrl}/api/v1/documents/${existingDocument.id}/download`)).status(), 200);
    console.log("scanner timeout: readiness and reads failed within deadline, upload left no data, recovery restored service.");
  }
  if (disableScanner) {
    disableScanner();
    const readiness = await fetch(`${baseUrl}/api/v1/system/ready`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(readiness.status, 503);
    assert.equal((await readiness.json()).scanner, "unavailable");
    const [existingDocument] = await sql`SELECT id FROM documents WHERE organization_id = ${member.organization_id} ORDER BY created_at LIMIT 1`;
    assert.equal((await archiveClient.get(`${baseUrl}/api/v1/documents/${existingDocument.id}/download`)).status(), 500);
    await page.context().clearCookies();
    await page.goto(`${baseUrl}/login`);
    await page.getByPlaceholder("Email или телефон").fill(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
    await page.getByPlaceholder("Пароль").fill(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.goto(`${baseUrl}/documents`);
    await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const unavailableDialog = page.getByRole("dialog", { name: "Новый документ", exact: true });
    await unavailableDialog.locator('summary[aria-label="Заказ"]').click();
    await unavailableDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await unavailableDialog.locator('input[name="title"]').fill("Scanner outage test");
    await unavailableDialog.locator('input[name="file"]').setInputFiles({ name: "outage.pdf", mimeType: "application/pdf", buffer: pdfFixture("Outage test") });
    const unavailableId = await unavailableDialog.locator('input[name="idempotencyKey"]').inputValue();
    await unavailableDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await unavailableDialog.getByRole("status").filter({ hasText: "Проверка файла временно недоступна." }).waitFor();
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${unavailableId}`)[0].count, 0);
    if (!objectStorage) assert.ok(!(await readdir(directory, { recursive: true })).some((entry) => entry.includes(unavailableId)));
    console.log("scanner outage: readiness failed, old file was not served, new file was not saved.");
  }
  if (objectStorage) {
    assert.deepEqual(await readdir(directory), [], "S3 mode must not write files to the local document root");
    const stagingDirectory = join(directory, "verified-s3-snapshot");
    const snapshot = await withStorageSnapshot({
      databaseUrl: environment.DATABASE_URL, objectStorage, stagingDirectory, copyTimeoutMs: 30000,
    }, async (snapshot) => snapshot);
    const verified = await verifyRestoredFiles(sql, stagingDirectory);
    assert.deepEqual(verified.verifiedFileCounts, snapshot.snapshotFileCounts);
    assert.equal(verified.verifiedFileBytes, snapshot.snapshotFileBytes);
    for (const count of Object.values(snapshot.snapshotFileCounts)) assert.ok(count > 0);
    console.log("S3 backup staging matches all four reference families and historical checksums; no local upload fallback.");
  }
  if (environment.CRM_FILE_SCAN_MODE !== "required") {
    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    server.kill("SIGTERM");
    await serverExit;
    commitProxy = await startCommitLossProxy(environment.DATABASE_URL);
    server = spawn(process.execPath, [resolve(runtime)], {
      env: { ...environment, DATABASE_URL: commitProxy.databaseUrl }, stdio: ["ignore", "pipe", "pipe"],
    });
    serverExit = once(server, "exit");
    server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await new Promise((resolveReady, reject) => {
      const timeout = setTimeout(() => reject(new Error("Commit-loss standalone startup exceeded 30 seconds")), 30_000);
      server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Commit-loss standalone exited ${code}`)); });
      server.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); resolveReady(); }
      });
    });
    const commitContext = await browser.newContext({ storageState: await archiveClient.storageState(), viewport: { width: 1440, height: 1000 } });
    const commitPage = await commitContext.newPage();
    const commitPageErrors = [];
    commitPage.on("pageerror", (error) => commitPageErrors.push(error.message));
    await commitPage.goto(`${baseUrl}/documents`);
    await commitPage.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const commitDialog = commitPage.getByRole("dialog", { name: "Новый документ", exact: true });
    await commitDialog.locator('summary[aria-label="Заказ"]').click();
    await commitDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await commitDialog.locator('input[name="title"]').fill("Lost database COMMIT acknowledgement");
    const commitBytes = pdfFixture("Lost database COMMIT acknowledgement");
    await commitDialog.locator('input[name="file"]').setInputFiles({ name: "commit-lost.pdf", mimeType: "application/pdf", buffer: commitBytes });
    const commitDocumentId = await commitDialog.locator('input[name="idempotencyKey"]').inputValue();
    await commitDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await commitDialog.getByRole("status").filter({ hasText: "Не удалось подтвердить" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 1);
    assert.deepEqual(commitProxy.errors, []);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${commitDocumentId}`)[0].count, 1);
    const [committedVersion] = await sql`SELECT storage_key FROM document_versions WHERE document_id = ${commitDocumentId}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitDialog.locator('input[name="idempotencyKey"]').inputValue(), commitDocumentId);
    assert.equal(await commitDialog.locator('input[name="title"]').inputValue(), "Lost database COMMIT acknowledgement");
    assert.equal(await commitDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "commit-lost.pdf");
    assert.deepEqual(commitPageErrors, []);
    await commitPage.screenshot({ path: join(artifacts, "document-lost-commit.png") });
    await commitDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await commitDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitDocumentId}`)[0].count, 1);
    await verifyVersion(commitDocumentId, 1, commitBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost database COMMIT acknowledgement: committed document and file survived; retry did not duplicate or erase the durable unresolved operation.");

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    await commitPage.goto(`${baseUrl}/documents?document=${commitDocumentId}`);
    await commitPage.getByRole("button", { name: "Новая версия", exact: true }).click();
    const commitVersionDialog = commitPage.getByRole("dialog", { name: "Новая версия документа", exact: true });
    await commitVersionDialog.locator('textarea[name="changeNote"]').fill("Lost version COMMIT acknowledgement");
    const commitVersionBytes = pdfFixture("Lost version COMMIT acknowledgement");
    await commitVersionDialog.locator('input[name="file"]').setInputFiles({ name: "version-commit-lost.pdf", mimeType: "application/pdf", buffer: commitVersionBytes });
    const commitVersionKey = await commitVersionDialog.locator('input[name="idempotencyKey"]').inputValue();
    commitProxy.armNextCommit();
    await commitVersionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
    await commitVersionDialog.getByRole("status").filter({ hasText: "Не удалось подтвердить сохранение версии" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 2);
    assert.deepEqual(commitProxy.errors, []);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitDocumentId}`)[0].count, 2);
    const [committedSecondVersion] = await sql`SELECT storage_key FROM document_versions WHERE document_id = ${commitDocumentId} AND version_number = 2`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedSecondVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitVersionDialog.locator('input[name="idempotencyKey"]').inputValue(), commitVersionKey);
    assert.equal(await commitVersionDialog.locator('textarea[name="changeNote"]').inputValue(), "Lost version COMMIT acknowledgement");
    assert.equal(await commitVersionDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "version-commit-lost.pdf");
    assert.deepEqual(commitPageErrors, []);
    await commitVersionDialog.getByRole("button", { name: "Сохранить версию 2", exact: true }).click();
    await commitVersionDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitDocumentId}`)[0].count, 2);
    await verifyVersion(commitDocumentId, 1, commitBytes);
    await verifyVersion(commitDocumentId, 2, commitVersionBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedSecondVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost version COMMIT acknowledgement: both versions survived; retry did not duplicate or erase the durable unresolved operation.");

    for (const kind of ["payment", "payout"]) {
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
      await commitPage.goto(`${baseUrl}/finance`);
      if (kind === "payment") {
        const summary = commitPage.locator("summary").filter({ hasText: "UPLOAD-1" }).first();
        if (await summary.locator("..").getAttribute("open") === null) await summary.click();
        await commitPage.getByRole("button", { name: "Добавить оплату", exact: true }).click();
      } else {
        await commitPage.getByRole("tab", { name: "Мастера", exact: true }).click();
        await commitPage.getByRole("button", { name: "Провести выплату", exact: true }).click();
      }
      const label = kind === "payment" ? "Провести оплату" : "Провести выплату";
      const commitFinanceDialog = commitPage.getByRole("dialog", { name: kind === "payment" ? "Оплата клиента" : "Выплата мастеру", exact: true });
      await commitFinanceDialog.locator('input[name="amount"]').fill("100");
      await commitFinanceDialog.locator('input[name="reference"]').fill(`Lost ${kind} COMMIT acknowledgement`);
      await commitFinanceDialog.locator('textarea[name="note"]').fill(`Lost ${kind} COMMIT note`);
      const commitReceiptBytes = pdfFixture(`Lost ${kind} COMMIT acknowledgement`);
      await commitFinanceDialog.locator('input[name="receipt"]').setInputFiles({ name: `${kind}-commit-lost.pdf`, mimeType: "application/pdf", buffer: commitReceiptBytes });
      const financeKey = await commitFinanceDialog.locator('input[name="idempotencyKey"]').inputValue();
      const receiptId = await commitFinanceDialog.locator('input[name="receiptDocumentId"]').inputValue();
      commitProxy.armNextCommit();
      await commitFinanceDialog.getByRole("button", { name: label, exact: true }).click();
      await commitFinanceDialog.getByRole("status").filter({ hasText: kind === "payment" ? "Не удалось подтвердить оплату" : "Не удалось подтвердить выплату" }).waitFor();
      assert.equal(commitProxy.droppedCommits, kind === "payment" ? 3 : 4);
      assert.deepEqual(commitProxy.errors, []);
      const table = kind === "payment" ? "order_payments" : "order_master_payouts";
      const [entry] = await sql`SELECT receipt_document_id, amount_minor FROM ${sql(table)} WHERE organization_id = ${member.organization_id} AND idempotency_key = ${financeKey}`;
      assert.equal(entry.receipt_document_id, receiptId);
      assert.equal(Number(entry.amount_minor), 10000);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${receiptId}`)[0].count, 1);
      const [receiptVersion] = await sql`SELECT storage_key FROM document_versions WHERE document_id = ${receiptId}`;
      assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${receiptVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
      assert.equal(await commitFinanceDialog.locator('input[name="idempotencyKey"]').inputValue(), financeKey);
      assert.equal(await commitFinanceDialog.locator('input[name="receiptDocumentId"]').inputValue(), receiptId);
      assert.equal(await commitFinanceDialog.locator('input[name="amount"]').inputValue(), "100");
      assert.equal(await commitFinanceDialog.locator('input[name="reference"]').inputValue(), `Lost ${kind} COMMIT acknowledgement`);
      assert.equal(await commitFinanceDialog.locator('textarea[name="note"]').inputValue(), `Lost ${kind} COMMIT note`);
      assert.equal(await commitFinanceDialog.locator('input[name="receipt"]').evaluate((input) => input.files?.[0]?.name), `${kind}-commit-lost.pdf`);
      assert.deepEqual(commitPageErrors, []);
      await commitFinanceDialog.getByRole("button", { name: label, exact: true }).click();
      await commitFinanceDialog.waitFor({ state: "hidden" });
      assert.equal((await sql`SELECT count(*)::integer AS count FROM ${sql(table)} WHERE idempotency_key = ${financeKey}`)[0].count, 1);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${receiptId}`)[0].count, 1);
      await verifyVersion(receiptId, 1, commitReceiptBytes);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${receiptVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
      console.log(`lost ${kind} COMMIT acknowledgement: one ledger entry and receipt survived; retry did not duplicate or erase the durable unresolved operation.`);
    }

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    await commitPage.goto(`${baseUrl}/settings`);
    await commitPage.getByRole("tab", { name: "Шаблоны документов", exact: true }).click();
    await commitPage.getByRole("button", { name: "Добавить шаблон", exact: true }).click();
    const commitTemplateDialog = commitPage.getByRole("dialog", { name: "Шаблон закрывающего акта", exact: true });
    await commitTemplateDialog.locator('input[name="title"]').fill("Lost template COMMIT acknowledgement");
    await commitTemplateDialog.locator('textarea[name="description"]').fill("Description retained after lost COMMIT");
    const commitTemplateBytes = pdfFixture("Lost template COMMIT acknowledgement");
    await commitTemplateDialog.locator('input[name="file"]').setInputFiles({ name: "template-commit-lost.pdf", mimeType: "application/pdf", buffer: commitTemplateBytes });
    const commitTemplateId = await commitTemplateDialog.locator('input[name="idempotencyKey"]').inputValue();
    commitProxy.armNextCommit();
    await commitTemplateDialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
    await commitTemplateDialog.getByRole("status").filter({ hasText: "Не удалось подтвердить публикацию шаблона" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 5);
    assert.deepEqual(commitProxy.errors, []);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_templates WHERE id = ${commitTemplateId}`)[0].count, 1);
    const [committedTemplateVersion] = await sql`SELECT storage_key FROM document_template_versions WHERE template_id = ${commitTemplateId}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedTemplateVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitTemplateDialog.locator('input[name="idempotencyKey"]').inputValue(), commitTemplateId);
    assert.equal(await commitTemplateDialog.locator('input[name="title"]').inputValue(), "Lost template COMMIT acknowledgement");
    assert.equal(await commitTemplateDialog.locator('textarea[name="description"]').inputValue(), "Description retained after lost COMMIT");
    assert.equal(await commitTemplateDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "template-commit-lost.pdf");
    assert.deepEqual(commitPageErrors, []);
    await commitTemplateDialog.getByRole("button", { name: "Опубликовать шаблон", exact: true }).click();
    await commitTemplateDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_template_versions WHERE template_id = ${commitTemplateId}`)[0].count, 1);
    await verifyStoredReference("document_template_versions", "template_id", commitTemplateId, commitTemplateBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedTemplateVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost template COMMIT acknowledgement: one version survived; retry did not duplicate or erase the durable unresolved operation.");

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation IN ('chat_message', 'chat_upload')`;
    await commitPage.goto(`${baseUrl}/chat?channel=${lostChatChannel.id}`);
    await commitPage.locator('textarea[name="body"]').fill("Message retained after lost COMMIT");
    const commitChatBytes = pdfFixture("Lost chat COMMIT acknowledgement");
    await commitPage.locator('input[name="file"]').setInputFiles({ name: "chat-commit-lost.pdf", mimeType: "application/pdf", buffer: commitChatBytes });
    const commitMessageId = await commitPage.locator('input[name="idempotencyKey"]').inputValue();
    commitProxy.armNextCommit();
    await commitPage.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await commitPage.getByRole("alert").filter({ hasText: "Не удалось подтвердить отправку" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 6);
    assert.deepEqual(commitProxy.errors, []);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${commitMessageId}`)[0].count, 1);
    const [committedAttachment] = await sql`SELECT storage_key FROM chat_message_attachments WHERE message_id = ${commitMessageId}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedAttachment.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitPage.locator('input[name="idempotencyKey"]').inputValue(), commitMessageId);
    assert.equal(await commitPage.locator('textarea[name="body"]').inputValue(), "Message retained after lost COMMIT");
    assert.equal(await commitPage.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "chat-commit-lost.pdf");
    assert.deepEqual(commitPageErrors, []);
    await commitPage.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await commitPage.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, commitMessageId);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_messages WHERE id = ${commitMessageId}`)[0].count, 1);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_message_attachments WHERE message_id = ${commitMessageId}`)[0].count, 1);
    await verifyStoredReference("chat_message_attachments", "message_id", commitMessageId, commitChatBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedAttachment.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost chat COMMIT acknowledgement: one message and attachment survived; retry did not duplicate or erase the durable unresolved operation.");

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation IN ('chat_action', 'chat_upload')`;
    const [commitAvatarChannel] = await sql`INSERT INTO chat_channels (organization_id, name, kind, audience_kind, created_by)
      VALUES (${member.organization_id}, 'Lost COMMIT avatar group', 'group', 'office', ${member.id}) RETURNING id`;
    await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
      VALUES (${member.organization_id}, ${commitAvatarChannel.id}, ${member.id}, 'owner', ${member.id})`;
    await commitPage.goto(`${baseUrl}/chat?channel=${commitAvatarChannel.id}`);
    await commitPage.getByRole("button", { name: "Настройки группы", exact: true }).click();
    const commitAvatarDialog = commitPage.getByRole("dialog", { name: "Настройки группы", exact: true });
    await commitAvatarDialog.locator('input[name="name"]').fill("Lost COMMIT avatar group updated");
    await commitAvatarDialog.locator('textarea[name="description"]').fill("Description retained after lost COMMIT");
    await commitAvatarDialog.locator('input[name="avatar"]').setInputFiles({ name: "avatar-commit-lost.png", mimeType: "image/png", buffer: imageBytes });
    commitProxy.armNextCommit();
    await commitAvatarDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await commitAvatarDialog.getByRole("status").filter({ hasText: "Не удалось подтвердить сохранение настроек" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 7);
    assert.deepEqual(commitProxy.errors, []);
    assert.deepEqual((await sql`SELECT name, description, version FROM chat_channels WHERE id = ${commitAvatarChannel.id}`)[0], {
      name: "Lost COMMIT avatar group updated", description: "Description retained after lost COMMIT", version: 2,
    });
    const [committedAvatar] = await sql`SELECT storage_key FROM chat_channel_avatars WHERE channel_id = ${commitAvatarChannel.id}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedAvatar.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitAvatarDialog.locator('input[name="name"]').inputValue(), "Lost COMMIT avatar group updated");
    assert.equal(await commitAvatarDialog.locator('textarea[name="description"]').inputValue(), "Description retained after lost COMMIT");
    assert.equal(await commitAvatarDialog.locator('input[name="avatar"]').evaluate((input) => input.files?.[0]?.name), "avatar-commit-lost.png");
    assert.deepEqual(commitPageErrors, []);
    await commitAvatarDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
    await commitAvatarDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT version FROM chat_channels WHERE id = ${commitAvatarChannel.id}`)[0].version, 2);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM chat_channel_avatars WHERE channel_id = ${commitAvatarChannel.id}`)[0].count, 1);
    await verifyStoredReference("chat_channel_avatars", "channel_id", commitAvatarChannel.id, imageBytes);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedAvatar.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost avatar COMMIT acknowledgement: one group version and photo survived; retry recognized the saved avatar without erasing the durable unresolved operation.");
    await commitContext.close();

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    const [commitVisit] = await sql`INSERT INTO service_visits (organization_id, order_id, object_id, assigned_master_id,
      scheduled_start_at, scheduled_end_at, status, client_name_snapshot, object_name_snapshot, object_address_snapshot)
      VALUES (${member.organization_id}, ${order.id}, ${object.id}, ${master.id},
        (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + interval '16 hours') AT TIME ZONE 'Europe/Moscow',
        (date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') + interval '17 hours') AT TIME ZONE 'Europe/Moscow',
        'planned', 'Upload customer', 'Upload object', 'Test address') RETURNING id`;
    const masterCommitContext = await browser.newContext({ storageState: masterStorageState, viewport: { width: 1440, height: 1000 } });
    const masterCommitPage = await masterCommitContext.newPage();
    const masterCommitErrors = [];
    masterCommitPage.on("pageerror", (error) => masterCommitErrors.push(error.message));
    await masterCommitPage.goto(`${baseUrl}/my-visits`);
    await masterCommitPage.getByRole("button", { name: "Материалы", exact: true }).last().click();
    const commitEvidenceDialog = masterCommitPage.getByRole("dialog", { name: "Материалы выезда", exact: true });
    assert.equal(await commitEvidenceDialog.locator('input[name="visitId"]').inputValue(), commitVisit.id);
    await commitEvidenceDialog.locator('textarea[name="note"]').fill("Lost visit photo COMMIT note");
    await commitEvidenceDialog.locator('input[name="file"]').setInputFiles({ name: "visit-commit-lost.png", mimeType: "image/png", buffer: imageBytes });
    const commitEvidenceId = await commitEvidenceDialog.locator('input[name="idempotencyKey"]').inputValue();
    commitProxy.armNextCommit();
    await commitEvidenceDialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
    await commitEvidenceDialog.getByRole("alert").filter({ hasText: "Не удалось подтвердить сохранение материала" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 8);
    assert.deepEqual(commitProxy.errors, []);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${commitEvidenceId}`)[0].count, 1);
    const [committedEvidenceVersion] = await sql`SELECT storage_key FROM document_versions WHERE document_id = ${commitEvidenceId}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedEvidenceVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitEvidenceDialog.locator('input[name="idempotencyKey"]').inputValue(), commitEvidenceId);
    assert.equal(await commitEvidenceDialog.locator('textarea[name="note"]').inputValue(), "Lost visit photo COMMIT note");
    assert.equal(await commitEvidenceDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "visit-commit-lost.png");
    assert.deepEqual(masterCommitErrors, []);
    await commitEvidenceDialog.getByRole("button", { name: "Добавить материал", exact: true }).click();
    await commitEvidenceDialog.waitFor({ state: "hidden" });
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitEvidenceId}`)[0].count, 1);
    await verifyVersion(commitEvidenceId, 1, imageBytes, true);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedEvidenceVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost visit photo COMMIT acknowledgement: one document survived; retry did not duplicate or erase the durable unresolved operation.");

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    await masterCommitPage.goto(`${baseUrl}/my-visits`);
    await masterCommitPage.getByRole("button", { name: "Завершить", exact: true }).last().click();
    const commitActDialog = masterCommitPage.getByRole("dialog", { name: "Завершить выезд", exact: true });
    assert.equal(await commitActDialog.locator('input[name="visitId"]').inputValue(), commitVisit.id);
    await commitActDialog.locator('input[name="actTitle"]').fill("Lost COMMIT signed act");
    await commitActDialog.locator('textarea[name="completionNotes"]').fill("Work completed before COMMIT acknowledgement was lost");
    const commitActBytes = pdfFixture("Lost signed act COMMIT acknowledgement");
    await commitActDialog.locator('input[name="file"]').setInputFiles({ name: "act-commit-lost.pdf", mimeType: "application/pdf", buffer: commitActBytes });
    const commitActId = await commitActDialog.locator('input[name="idempotencyKey"]').inputValue();
    commitProxy.armNextCommit();
    await commitActDialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
    await commitActDialog.getByRole("alert").filter({ hasText: "Не удалось подтвердить завершение выезда" }).waitFor();
    assert.equal(commitProxy.droppedCommits, 9);
    assert.deepEqual(commitProxy.errors, []);
    const [committedVisit] = await sql`SELECT status, completion_document_id, version FROM service_visits WHERE id = ${commitVisit.id}`;
    assert.equal(committedVisit.status, "completed");
    assert.equal(committedVisit.completion_document_id, commitActId);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitActId}`)[0].count, 1);
    const [committedActVersion] = await sql`SELECT storage_key FROM document_versions WHERE document_id = ${commitActId}`;
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedActVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await commitActDialog.locator('input[name="idempotencyKey"]').inputValue(), commitActId);
    assert.equal(await commitActDialog.locator('input[name="actTitle"]').inputValue(), "Lost COMMIT signed act");
    assert.equal(await commitActDialog.locator('textarea[name="completionNotes"]').inputValue(), "Work completed before COMMIT acknowledgement was lost");
    assert.equal(await commitActDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "act-commit-lost.pdf");
    assert.deepEqual(masterCommitErrors, []);
    await commitActDialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
    await commitActDialog.waitFor({ state: "hidden" });
    assert.deepEqual((await sql`SELECT status, completion_document_id, version FROM service_visits WHERE id = ${commitVisit.id}`)[0], committedVisit);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${commitActId}`)[0].count, 1);
    await verifyVersion(commitActId, 1, commitActBytes, true);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${committedActVersion.storage_key} = ANY(storage_keys)`)[0].count, 1);
    console.log("lost signed act COMMIT acknowledgement: visit completed once and act survived; retry did not erase the durable unresolved operation.");
    await masterCommitContext.close();

    await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
      WHERE organization_id = ${member.organization_id} AND operation = 'document_upload'`;
    const rollbackContext = await browser.newContext({ storageState: await archiveClient.storageState(), viewport: { width: 1440, height: 1000 } });
    const rollbackPage = await rollbackContext.newPage();
    const rollbackPageErrors = [];
    rollbackPage.on("pageerror", (error) => rollbackPageErrors.push(error.message));
    let abortRollbackRequest;
    const rollbackAbortSignal = new Promise((resolveAbort) => { abortRollbackRequest = resolveAbort; });
    let resolveRollbackAborted;
    const rollbackAborted = new Promise((resolveAbort) => { resolveRollbackAborted = resolveAbort; });
    let rollbackUpstream;
    let abortFirstRollback = true;
    await rollbackPage.route("**/documents", async (route) => {
      if (!abortFirstRollback || route.request().method() !== "POST" || !route.request().headers()["next-action"]) return route.continue();
      abortFirstRollback = false;
      rollbackUpstream = route.fetch();
      await rollbackAbortSignal;
      await route.abort("failed");
      resolveRollbackAborted();
      await rollbackUpstream.catch(() => {});
    });
    await rollbackPage.goto(`${baseUrl}/documents`);
    await rollbackPage.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
    const rollbackDialog = rollbackPage.getByRole("dialog", { name: "Новый документ", exact: true });
    await rollbackDialog.locator('summary[aria-label="Заказ"]').click();
    await rollbackDialog.getByRole("button", { name: /UPLOAD-1/ }).click();
    await rollbackDialog.locator('input[name="title"]').fill("Aborted before forced database rollback");
    const rollbackBytes = pdfFixture("Aborted before forced database rollback");
    await rollbackDialog.locator('input[name="file"]').setInputFiles({ name: "aborted-rollback.pdf", mimeType: "application/pdf", buffer: rollbackBytes });
    const rollbackDocumentId = await rollbackDialog.locator('input[name="idempotencyKey"]').inputValue();
    const rollbackStorageKey = `${member.organization_id}/${rollbackDocumentId}/v1.pdf`;
    await sql`INSERT INTO upload_abort_gate (document_id) VALUES (${rollbackDocumentId})`;
    const rollbackGate = await sql.reserve();
    let rollbackGateLocked = false;
    try {
      await rollbackGate`SELECT pg_advisory_lock(927431, 9)`;
      rollbackGateLocked = true;
      await rollbackDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
      let blockedPid = null;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [activity] = await sql`SELECT pid FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory'
            AND query LIKE '%INSERT INTO document_versions%' LIMIT 1`;
        if (activity) { blockedPid = activity.pid; break; }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
      assert.ok(blockedPid, "Rollback upload must reach the database after writing its file");
      const stored = objectStorage
        ? await objectStorage.readVerified(rollbackStorageKey, { sizeBytes: rollbackBytes.length, sha256: createHash("sha256").update(rollbackBytes).digest("hex") }, 15 * 1024 * 1024)
        : await readFile(join(directory, rollbackStorageKey));
      assert.deepEqual(stored, rollbackBytes);
      assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${rollbackDocumentId}`)[0].count, 0);
      abortRollbackRequest();
      await rollbackAborted;
      await rollbackDialog.getByRole("status").filter({ hasText: "Не удалось получить ответ сервера. Проверьте документ в архиве перед повторной отправкой." }).waitFor();
      const [terminated] = await sql`SELECT pg_terminate_backend(${blockedPid}) AS terminated`;
      assert.equal(terminated.terminated, true);
    } finally {
      if (rollbackGateLocked) await rollbackGate`SELECT pg_advisory_unlock(927431, 9)`;
      rollbackGate.release();
    }
    const rollbackResponse = await rollbackUpstream;
    assert.equal(rollbackResponse.status(), 200);
    assert.match(await rollbackResponse.text(), /Не удалось подтвердить сохранение документа/);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${rollbackDocumentId}`)[0].count, 0);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${rollbackDocumentId}`)[0].count, 0);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${rollbackStorageKey} = ANY(storage_keys)`)[0].count, 1);
    assert.equal(await rollbackDialog.locator('input[name="idempotencyKey"]').inputValue(), rollbackDocumentId);
    assert.equal(await rollbackDialog.locator('input[name="title"]').inputValue(), "Aborted before forced database rollback");
    assert.equal(await rollbackDialog.locator('input[name="file"]').evaluate((input) => input.files?.[0]?.name), "aborted-rollback.pdf");
    assert.deepEqual(rollbackPageErrors, []);
    await rollbackDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
    await rollbackDialog.getByRole("status").filter({ hasText: "Файл этого запроса уже существует, но документ не подтверждён" }).waitFor();
    assert.equal((await sql`SELECT count(*)::integer AS count FROM documents WHERE id = ${rollbackDocumentId}`)[0].count, 0);
    assert.equal((await sql`SELECT count(*)::integer AS count FROM file_write_operations WHERE ${rollbackStorageKey} = ANY(storage_keys)`)[0].count, 1);
    const retained = objectStorage
      ? await objectStorage.readVerified(rollbackStorageKey, { sizeBytes: rollbackBytes.length, sha256: createHash("sha256").update(rollbackBytes).digest("hex") }, 15 * 1024 * 1024)
      : await readFile(join(directory, rollbackStorageKey));
    assert.deepEqual(retained, rollbackBytes);
    console.log("aborted in flight with forced database rollback: no document committed; file and unresolved operation remained, and retry did not adopt the uncertain bytes.");
    await rollbackContext.close();
  }
  if (objectStorage) {
    await s3Fixture.close();
    const unavailable = await fetch(`${baseUrl}/api/v1/system/ready`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(unavailable.status, 503, "S3 outage must make readiness fail while PostgreSQL remains available");
    assert.deepEqual(await unavailable.json(), { status: "unavailable", service: "crm-web", database: "available", storage: "unavailable", scanner: process.env.CRM_FILE_SCAN_MODE === "required" ? "available" : "disabled" });
    assert.equal((await fetch(`${baseUrl}/api/v1/system/live`, { signal: AbortSignal.timeout(10_000) })).status, 200);
    console.log("S3 outage makes readiness fail while liveness remains available.");
  }
  console.log("Upload browser check passed: 24 standard submissions, 9 lost post-commit responses, 9 lost PostgreSQL COMMIT acknowledgements, 1 pre-dispatch abort, 1 in-flight commit, 1 in-flight rollback, 9 injected warning states, no browser errors.");
  await page.context().tracing.stop();
} catch (error) {
  if (page) {
    for (const capture of [
      () => page.screenshot({ path: join(artifacts, "failure.png") }),
      () => page.context().tracing.stop({ path: join(artifacts, "failure-trace.zip") }),
    ]) {
      try { await capture(); }
      catch (captureError) { console.error("Browser diagnostic capture failed:", captureError); }
    }
  }
  throw error;
} finally {
  await archiveClient?.dispose();
  await browser?.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  await commitProxy?.close();
  if (scannerProxy) await new Promise((resolveClosed) => scannerProxy.close(resolveClosed));
  await sql?.end();
  try { if (databaseCreated) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally {
    await admin.end(); objectStorage?.close();
    try { await s3Fixture?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
