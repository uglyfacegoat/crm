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
        assert.match(await dialog.getByRole("status").innerText(), /загрузка ещё обрабатывается|Документ уже загружен/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
    }
    if (!warn) {
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateDocumentResponse, "Concurrent duplicate POST must run");
      assert.equal(duplicateDocumentResponse.status, 200);
      assert.match(duplicateDocumentResponse.body, /Документ уже загружен|загрузка ещё обрабатывается|Документ сохранён в архиве/);
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
        assert.match(await dialog.getByRole("status").innerText(), /Фото группы уже обрабатывается|Настройки уже изменились|Настройки группы сохранены/i);
        await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
      }
      if (interceptionError) throw interceptionError;
      assert.ok(duplicateOtherResponse, "Concurrent duplicate chat-avatar POST must run");
      assert.equal(duplicateOtherResponse.status, 200);
      assert.match(duplicateOtherResponse.body, /Фото группы уже обрабатывается|Настройки уже изменились|Настройки группы сохранены/i);
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
    await submit(dialog, "Добавить материал", warn ? { saved: "Материал сохранён в документах заказа.", warning: "Материал сохранён, но страницу не удалось обновить. Обновите её вручную." } : null, "evidence-warning.png");
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
    await submit(dialog, "Завершить с актом", warn ? { saved: "Выезд завершён, акт добавлен в архив.", warning: "Выезд завершён, акт сохранён, но страницу не удалось обновить. Обновите её вручную." } : null, "closing-act-warning.png", "Выезд завершён");
    await verifyVersion(actId, 1, actBytes, true);
    if (!warn) assert.equal((await sql`SELECT count(*)::integer AS count FROM document_versions WHERE document_id = ${actId}`)[0].count, 1);
    const [completed] = await sql`SELECT status, completion_document_id FROM service_visits WHERE id = ${visit.id}`;
    assert.deepEqual(completed, { status: "completed", completion_document_id: actId });
    if (!warn) console.log("processing slots: visit photo and signed act retained their fields; retries wrote one file each and completed the visit once.");
    console.log(`${warn ? "warning" : "normal"}: master photo and signed act persisted; visit completed.`);
  }
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
    await s3Fixture.close();
    const unavailable = await fetch(`${baseUrl}/api/v1/system/ready`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(unavailable.status, 503, "S3 outage must make readiness fail while PostgreSQL remains available");
    assert.deepEqual(await unavailable.json(), { status: "unavailable", service: "crm-web", database: "available", storage: "unavailable", scanner: process.env.CRM_FILE_SCAN_MODE === "required" ? "available" : "disabled" });
    assert.equal((await fetch(`${baseUrl}/api/v1/system/live`, { signal: AbortSignal.timeout(10_000) })).status, 200);
    console.log("S3 outage makes readiness fail while liveness remains available.");
  }
  console.log("Upload browser check passed: 23 real submissions, 9 injected warning states, no browser errors.");
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
  if (scannerProxy) await new Promise((resolveClosed) => scannerProxy.close(resolveClosed));
  await sql?.end();
  try { if (databaseCreated) await admin`DROP DATABASE ${admin(databaseName)}`; }
  finally {
    await admin.end(); objectStorage?.close();
    try { await s3Fixture?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
}
