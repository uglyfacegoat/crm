import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.BACKUP_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.BACKUP_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BACKUP_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Backup UI check credentials are required.");

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 320, height: 568 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

async function verifyViewport(width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Резервные копии", exact: true }).click();
  await page.getByRole("heading", { name: "Резервное копирование", exact: true }).waitFor();
  await page.getByText("Проверен", { exact: true }).first().waitFor();
  const layout = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (layout.document > layout.viewport) throw new Error(`Settings overflow at ${width}px: ${layout.document}px.`);
}

try {
  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/settings`);
  }
  await verifyViewport(320, 568);
  await verifyViewport(3840, 2160);
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }
  console.log(JSON.stringify({ operation: "backup.ui_check", status: "succeeded", viewports: [320, 3840] }));
} finally {
  await browser.close();
}
