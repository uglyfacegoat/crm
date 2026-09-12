import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserPaths = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = browserPaths.find(existsSync);
if (!executablePath) throw new Error("Chrome or Edge was not found.");

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:3000";
const identity = process.env.VISUAL_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.VISUAL_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!identity || !password) throw new Error("Admin credentials are required for the company flow check.");

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
const page = await context.newPage();

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Компании", exact: true }).click();

  for (const companyName of ["ТехСтройИнвест", "BioSave"]) {
    if (await page.getByRole("heading", { name: companyName, exact: true }).count()) continue;
    await page.getByRole("button", { name: "Новая компания", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Новая компания", exact: true });
    await dialog.getByPlaceholder("Например, ТехСтройИнвест").fill(companyName);
    await dialog.getByRole("button", { name: "Создать компанию", exact: true }).click();
    await dialog.getByText("Компания создана и доступна в переключателе.").waitFor();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
  }

  await page.goto(`${baseUrl}/companies`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Компании", exact: true }).waitFor();
  await page.getByRole("button").filter({ hasText: "BioSave" }).first().click();
  await page.getByRole("button", { name: "Открыть рабочую базу", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.goto(`${baseUrl}/companies`, { waitUntil: "networkidle" });
  await page.getByRole("button").filter({ hasText: "Центр компаний" }).first().click();
  await page.getByRole("button", { name: "Открыть рабочую базу", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  console.log("Company creation and tenant switching passed.");
} catch (error) {
  console.error(`Company flow failed at ${page.url()}`);
  console.error(`Sidebar: ${(await page.locator("aside").first().innerText().catch(() => "not rendered")).slice(0, 600)}`);
  await page.screenshot({ path: "artifacts/visual/company-flow-failure.png", fullPage: true });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
