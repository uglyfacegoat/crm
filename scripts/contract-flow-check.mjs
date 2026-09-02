import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import postgres from "postgres";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.CONTRACT_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.CONTRACT_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.CONTRACT_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Contract flow credentials are required.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for contract flow verification.");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

const suffix = String(Date.now()).slice(-7);
const contractNumber = `E2E-${suffix}`;
let contractId = null;

try {
  await page.goto(`${baseUrl}/contracts`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/contracts`);
  }
  await page.getByRole("heading", { name: "Договоры", exact: true }).waitFor();
  await page.getByRole("button", { name: "Новый договор", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Новый договор" });
  const objectSelect = dialog.locator('select[name="objectId"]');
  if (await objectSelect.locator("option").count() < 2) throw new Error("Contract flow requires at least one client object.");
  const objectId = await objectSelect.locator("option").nth(1).getAttribute("value");
  if (!objectId) throw new Error("The first contract object has no identifier.");
  await objectSelect.selectOption(objectId);
  await dialog.locator('input[name="contractNumber"]').fill(contractNumber);
  await dialog.locator('input[name="startsOn"]').fill("2026-09-03");
  await dialog.locator('input[name="endsOn"]').fill("2026-12-03");
  await dialog.getByRole("button", { name: "Создать договор" }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: contractNumber, exact: true }).waitFor();

  const [contract] = await sql`SELECT id FROM contracts WHERE contract_number = ${contractNumber}`;
  if (!contract) throw new Error("The created contract is absent from PostgreSQL.");
  contractId = contract.id;
  const [counts] = await sql`SELECT
      (SELECT count(*)::integer FROM contract_schedule_rules WHERE contract_id = ${contractId}) AS rule_count,
      (SELECT count(*)::integer FROM service_visits WHERE contract_id = ${contractId}) AS visit_count,
      (SELECT count(*)::integer FROM tasks JOIN service_visits ON service_visits.id = tasks.related_visit_id WHERE service_visits.contract_id = ${contractId}) AS task_count,
      (SELECT count(*)::integer FROM contract_events WHERE contract_id = ${contractId}) AS event_count`;
  if (counts.rule_count !== 1 || counts.visit_count !== 4 || counts.task_count !== 4 || counts.event_count < 1) {
    throw new Error(`Contract graph is incomplete: ${JSON.stringify(counts)}`);
  }
  const searchResult = await page.evaluate(async (number) => {
    const response = await fetch(`/api/v1/search?q=${encodeURIComponent(number)}`);
    return { status: response.status, payload: await response.json() };
  }, contractNumber);
  const foundContract = searchResult.payload?.data?.results?.find((result) => result.entityType === "contract" && result.id === contractId);
  if (searchResult.status !== 200 || !foundContract) throw new Error(`Global contract search failed: ${JSON.stringify(searchResult)}`);

  await page.getByRole("button", { name: `История договора ${contractNumber}` }).click();
  const history = page.getByRole("dialog", { name: "История договора" });
  await history.getByText("Договор создан", { exact: true }).waitFor();
  await page.setViewportSize({ width: 3840, height: 2160 });
  const viewport = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, overlay: Boolean(document.querySelector("[data-nextjs-dialog]")), hasContent: document.body.innerText.trim().length > 0 }));
  if (!viewport.hasContent || viewport.overlay || viewport.document > viewport.viewport) throw new Error(`Invalid 4K contract viewport: ${JSON.stringify(viewport)}`);
  await history.getByRole("button", { name: "Закрыть окно" }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  const mobile = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (mobile.document > mobile.viewport) throw new Error(`Contract page overflows mobile viewport: ${JSON.stringify(mobile)}`);
  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
  process.stdout.write(`${JSON.stringify({ contractNumber, contractId, ...counts })}\n`);
} finally {
  await browser.close();
  if (contractId) {
    await sql.begin(async (transaction) => {
      await transaction`DELETE FROM task_events WHERE task_id IN (SELECT tasks.id FROM tasks JOIN service_visits ON service_visits.id = tasks.related_visit_id WHERE service_visits.contract_id = ${contractId})`;
      await transaction`DELETE FROM tasks WHERE related_visit_id IN (SELECT id FROM service_visits WHERE contract_id = ${contractId})`;
      await transaction`DELETE FROM service_visit_events WHERE visit_id IN (SELECT id FROM service_visits WHERE contract_id = ${contractId})`;
      await transaction`DELETE FROM service_visits WHERE contract_id = ${contractId}`;
      await transaction`DELETE FROM contract_schedule_rules WHERE contract_id = ${contractId}`;
      await transaction`DELETE FROM contract_events WHERE contract_id = ${contractId}`;
      await transaction`DELETE FROM audit_events WHERE entity_type = 'contract' AND entity_id = ${contractId}`;
      await transaction`DELETE FROM idempotency_requests WHERE entity_id = ${contractId}`;
      await transaction`DELETE FROM contracts WHERE id = ${contractId}`;
    });
  }
  await sql.end();
}
