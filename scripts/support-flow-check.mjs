import { existsSync } from "node:fs";
import postgres from "postgres";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.SUPPORT_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.SUPPORT_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.SUPPORT_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password || !process.env.DATABASE_URL) throw new Error("Support flow credentials and DATABASE_URL are required.");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

const suffix = Date.now().toString(36);
const subject = `Проверка поддержки ${suffix}`;
const description = `Автоматическая проверка регистрации обращения ${suffix}: форма должна сохранить данные и показать номер в истории.`;
let requestId = null;

try {
  await page.goto(`${baseUrl}/help`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/help`);
  }
  await page.getByRole("heading", { name: "Документация и поддержка", exact: true }).waitFor();
  await page.getByRole("button", { name: "Связаться с поддержкой", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Обращение в поддержку" });
  await dialog.locator('select[name="category"]').selectOption("technical");
  await dialog.locator('input[name="subject"]').fill(subject);
  await dialog.locator('textarea[name="description"]').fill(description);
  await dialog.getByRole("button", { name: "Создать обращение", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText(subject, { exact: true }).waitFor();

  const [request] = await sql`SELECT id, organization_id, requested_by, category, status, description
    FROM support_requests WHERE subject = ${subject}`;
  requestId = request?.id ?? null;
  if (!requestId || request.category !== "technical" || request.status !== "new" || request.description !== description) {
    throw new Error(`Support request is inconsistent: ${JSON.stringify(request)}`);
  }
  const [audit] = await sql`SELECT changes::text FROM audit_events
    WHERE organization_id = ${request.organization_id} AND entity_type = 'support_request' AND entity_id = ${requestId}`;
  if (!audit || audit.changes.includes(description)) throw new Error("Support request description leaked into the audit log.");

  for (const [width, height] of [[320, 568], [3840, 2160]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (layout.document > layout.viewport) throw new Error(`Help page overflow at ${width}px: ${layout.document}px.`);
  }
  if (pageErrors.length || consoleErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  console.log(JSON.stringify({ operation: "support.flow_check", status: "succeeded", requestId, auditProtected: true, viewports: [320, 3840] }));
} finally {
  await browser.close();
  try {
    if (requestId) {
      await sql.begin(async (transaction) => {
        await transaction`DELETE FROM audit_events WHERE entity_type = 'support_request' AND entity_id = ${requestId}`;
        await transaction`DELETE FROM idempotency_requests WHERE operation = 'support.request.create' AND entity_id = ${requestId}`;
        await transaction`DELETE FROM support_requests WHERE id = ${requestId}`;
      });
    }
  } finally {
    await sql.end();
  }
}
