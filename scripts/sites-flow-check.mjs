import { existsSync } from "node:fs";
import postgres from "postgres";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.SITES_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.SITES_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.SITES_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;

if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password || !process.env.DATABASE_URL) throw new Error("Sites flow credentials and DATABASE_URL are required.");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

const suffix = Date.now().toString(36);
const siteName = `E2E Сайт ${suffix}`;
const domain = `e2e-${suffix}.crm-test.ru`;
const propertyId = `e2e-counter-${suffix}`;
const secretReference = `YANDEX_METRICA_E2E_${suffix.toUpperCase()}`;
let websiteId = null;
let integrationId = null;

try {
  await page.goto(`${baseUrl}/sites`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/sites`);
  }

  await page.getByRole("heading", { name: "Сайты и трафик", exact: true }).waitFor();
  await page.getByRole("button", { name: "Подключить сайт", exact: true }).click();
  const websiteDialog = page.getByRole("dialog", { name: "Новый сайт" });
  await websiteDialog.locator('input[name="name"]').fill(siteName);
  await websiteDialog.locator('input[name="domain"]').fill(domain);
  await websiteDialog.getByRole("button", { name: "Добавить сайт", exact: true }).click();
  await websiteDialog.waitFor({ state: "hidden" });

  const siteCard = page.locator("article").filter({ has: page.getByRole("heading", { name: siteName, exact: true }) });
  await siteCard.waitFor();
  await siteCard.getByRole("button", { name: "Подключения", exact: true }).click();
  const integrationDialog = page.getByRole("dialog", { name: `Подключения · ${siteName}` });
  await integrationDialog.getByRole("button", { name: "Метрика", exact: true }).click();
  await integrationDialog.locator('input[name="propertyId"]').fill(propertyId);
  await integrationDialog.locator('input[name="secretReference"]').fill(secretReference);
  await integrationDialog.getByRole("button", { name: "Сохранить подключение", exact: true }).click();
  await integrationDialog.waitFor({ state: "hidden" });
  await siteCard.getByText("Метрика", { exact: true }).waitFor();

  const [website] = await sql`SELECT id, organization_id, status FROM websites WHERE domain = ${domain}`;
  websiteId = website?.id ?? null;
  if (!websiteId || website.status !== "setup") throw new Error(`Website was not persisted correctly: ${JSON.stringify(website)}`);
  const [integration] = await sql`SELECT id, status, external_property_id, credential_secret_reference
    FROM website_integrations WHERE organization_id = ${website.organization_id} AND website_id = ${websiteId} AND provider = 'yandex_metrica'`;
  integrationId = integration?.id ?? null;
  if (!integrationId || integration.status !== "pending" || integration.external_property_id !== propertyId || integration.credential_secret_reference !== secretReference) {
    throw new Error(`Website integration is inconsistent: ${JSON.stringify(integration)}`);
  }
  const [audit] = await sql`SELECT changes::text FROM audit_events
    WHERE organization_id = ${website.organization_id} AND entity_type = 'website_integration' AND entity_id = ${integrationId}`;
  if (!audit || audit.changes.includes(secretReference)) throw new Error("Credential reference leaked into the audit log.");
  if ((await page.locator("body").innerText()).includes(secretReference)) throw new Error("Credential reference remained visible after the integration dialog closed.");

  await siteCard.getByRole("link", { name: "Карточка", exact: true }).click();
  await page.waitForURL(`${baseUrl}/sites/${websiteId}`);
  await page.getByRole("button", { name: "Настроить инфраструктуру", exact: true }).click();
  const infrastructureDialog = page.getByRole("dialog", { name: "Инфраструктура сайта" });
  await infrastructureDialog.getByText("Активен", { exact: true }).click();
  await infrastructureDialog.locator('input[name="hostingProvider"]').fill("Selectel E2E");
  await infrastructureDialog.locator('input[name="planName"]').fill("Cloud Test");
  await infrastructureDialog.locator('input[name="serverRegion"]').fill("Москва");
  await infrastructureDialog.locator('input[name="monthlyCost"]').fill("4900,50");
  await infrastructureDialog.locator('[data-form-name="renewalOn"]').fill("03.10.2026");
  await infrastructureDialog.locator('[data-form-name="sslExpiresOn"]').fill("18.12.2026");
  await infrastructureDialog.locator('input[name="diskCapacityMb"]').fill("102400");
  await infrastructureDialog.locator('input[name="memoryCapacityMb"]').fill("8192");
  await infrastructureDialog.locator('input[name="uptimePercent"]').fill("99,98");
  await infrastructureDialog.locator('input[name="responseTimeMs"]').fill("184");
  await infrastructureDialog.locator('input[name="cpuLoadPercent"]').fill("37,2");
  await infrastructureDialog.locator('input[name="memoryUsedMb"]').fill("4096");
  await infrastructureDialog.locator('input[name="diskUsedMb"]').fill("38400");
  await infrastructureDialog.getByRole("button", { name: "Сохранить данные", exact: true }).click();
  await infrastructureDialog.waitFor({ state: "hidden" });
  await page.getByText("Selectel E2E", { exact: true }).waitFor();

  const [hosting] = await sql`SELECT provider, monthly_cost_minor::text, renewal_on::text, ssl_expires_on::text
    FROM website_hosting_profiles WHERE organization_id = ${website.organization_id} AND website_id = ${websiteId}`;
  const [health] = await sql`SELECT health_status, uptime_percent::text, response_time_ms, cpu_load_percent::text
    FROM website_health_snapshots WHERE organization_id = ${website.organization_id} AND website_id = ${websiteId}`;
  if (hosting?.provider !== "Selectel E2E" || hosting.monthly_cost_minor !== "490050" || hosting.renewal_on !== "2026-10-03" || hosting.ssl_expires_on !== "2026-12-18") {
    throw new Error(`Website hosting is inconsistent: ${JSON.stringify(hosting)}`);
  }
  if (health?.health_status !== "healthy" || health.uptime_percent !== "99.98" || health.response_time_ms !== 184 || health.cpu_load_percent !== "37.20") {
    throw new Error(`Website health snapshot is inconsistent: ${JSON.stringify(health)}`);
  }

  for (const [width, height] of [[320, 568], [3840, 2160]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (layout.document > layout.viewport) throw new Error(`Sites page overflow at ${width}px: ${layout.document}px.`);
  }
  if (pageErrors.length || consoleErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  console.log(JSON.stringify({ operation: "sites.flow_check", status: "succeeded", websiteId, integrationId, infrastructurePersisted: true, secretReferenceProtected: true, viewports: [320, 3840] }));
} finally {
  await browser.close();
  try {
    if (websiteId) {
      await sql.begin(async (transaction) => {
        if (integrationId) {
          await transaction`DELETE FROM audit_events WHERE entity_type = 'website_integration' AND entity_id = ${integrationId}`;
          await transaction`DELETE FROM idempotency_requests WHERE entity_id = ${integrationId}`;
        }
        await transaction`DELETE FROM audit_events WHERE entity_type = 'website' AND entity_id = ${websiteId}`;
        await transaction`DELETE FROM idempotency_requests WHERE entity_id = ${websiteId}`;
        await transaction`DELETE FROM websites WHERE id = ${websiteId} AND domain = ${domain}`;
      });
    }
  } finally {
    await sql.end();
  }
}
