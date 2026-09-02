import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.IMPORT_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.IMPORT_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.IMPORT_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password || !process.env.DATABASE_URL) throw new Error("Import UI check credentials and DATABASE_URL are required.");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

const templates = Object.fromEntries(["clients", "objects", "orders", "services", "documents"].map((dataset) => [
  dataset,
  fileURLToPath(new URL(`../public/import-templates/${dataset}.csv`, import.meta.url)),
]));

async function businessCounts() {
  const [row] = await sql`SELECT
    (SELECT count(*)::integer FROM clients) AS clients,
    (SELECT count(*)::integer FROM client_objects) AS objects,
    (SELECT count(*)::integer FROM orders) AS orders,
    (SELECT count(*)::integer FROM order_services) AS services,
    (SELECT count(*)::integer FROM documents) AS documents,
    (SELECT count(*)::integer FROM import_jobs) AS import_jobs`;
  return row;
}

async function submitPackage() {
  for (const [dataset, path] of Object.entries(templates)) await page.locator(`input[name="${dataset}File"]`).setInputFiles(path);
  await page.getByRole("button", { name: "Запустить dry-run", exact: true }).click();
  await page.getByRole("heading", { name: /Dry-run пройден|Найдены ошибки в пакете/ }).waitFor();
}

try {
  const before = await businessCounts();
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/settings`);
  }
  await page.getByRole("tab", { name: "Импорт данных", exact: true }).click();
  await page.getByRole("heading", { name: "Проверка выгрузки старой CRM", exact: true }).waitFor().catch(async (error) => {
    throw new Error(`Import tab did not open at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 3_000)}; browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`, { cause: error });
  });
  await submitPackage();
  const afterFirst = await businessCounts();
  for (const table of ["clients", "objects", "orders", "services", "documents"]) {
    if (afterFirst[table] !== before[table]) throw new Error(`Dry-run changed ${table}: ${before[table]} -> ${afterFirst[table]}.`);
  }
  await submitPackage();
  await page.getByText("Этот пакет уже проверялся — показан исходный отчёт.", { exact: true }).waitFor();
  const afterSecond = await businessCounts();
  if (afterSecond.import_jobs !== afterFirst.import_jobs) throw new Error("Idempotent dry-run created a duplicate import job.");

  for (const [width, height] of [[320, 568], [3840, 2160]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (layout.document > layout.viewport) throw new Error(`Import screen overflow at ${width}px: ${layout.document}px.`);
  }
  if (pageErrors.length || consoleErrors.length) throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  console.log(JSON.stringify({ operation: "import.ui_check", status: "succeeded", dryRunPreservedBusinessData: true, idempotent: true, viewports: [320, 3840] }));
} finally {
  await browser.close();
  await sql.end();
}
