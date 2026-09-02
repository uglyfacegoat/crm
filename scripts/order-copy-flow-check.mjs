import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.ORDER_COPY_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.ORDER_COPY_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.ORDER_COPY_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const configuredSourceId = process.env.ORDER_COPY_CHECK_SOURCE_ID;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("ORDER_COPY_CHECK_IDENTITY and ORDER_COPY_CHECK_PASSWORD are required.");

function tomorrowInMoscow() {
  const currentDateParts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const date = new Date(`${currentDateParts.year}-${currentDateParts.month}-${currentDateParts.day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/orders`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/orders`);
  }

  let sourcePath;
  if (configuredSourceId) {
    sourcePath = `/orders/${configuredSourceId}`;
    await page.goto(`${baseUrl}${sourcePath}`, { waitUntil: "networkidle" });
  } else {
    const sourceLink = page.locator('a[href^="/orders/"]:visible').first();
    await sourceLink.waitFor();
    sourcePath = await sourceLink.getAttribute("href");
    if (!sourcePath) throw new Error("No source order link was found.");
    await sourceLink.click();
    await page.waitForURL(`${baseUrl}${sourcePath}`);
  }
  const sourceHeading = await page.getByRole("heading", { name: /^Заказ / }).textContent();

  await page.getByRole("button", { name: "Копия", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Копия заказа / });
  await page.waitForTimeout(450);
  const mobileDialogBox = await dialog.boundingBox();
  if (!mobileDialogBox || mobileDialogBox.x < -1 || mobileDialogBox.x + mobileDialogBox.width > 391) {
    throw new Error(`Copy dialog overflows the mobile viewport: ${JSON.stringify(mobileDialogBox)}`);
  }
  await dialog.locator('input[name="copyDate"]').fill(tomorrowInMoscow());
  const expenses = dialog.locator("section").filter({ hasText: "Прямые расходы" });
  if (await expenses.count()) await expenses.getByRole("button", { name: "Выбрать все" }).click();
  const futureVisits = dialog.locator("section").filter({ hasText: "Будущие выезды" });
  if (await futureVisits.count()) await futureVisits.getByRole("button", { name: "Выбрать все" }).click();
  await dialog.getByRole("button", { name: "Создать копию", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/orders/") && url.pathname !== sourcePath, { timeout: 15_000 });
  const copiedPath = new URL(page.url()).pathname;
  const copiedHeading = await page.getByRole("heading", { name: /^Заказ / }).textContent();
  if (!copiedHeading || copiedHeading === sourceHeading) throw new Error("The copied order did not receive a new number.");
  await page.getByText("Новый", { exact: true }).first().waitFor();

  await page.goto(`${baseUrl}${sourcePath}`, { waitUntil: "networkidle" });
  if (await page.getByRole("heading", { name: sourceHeading ?? "" }).count() !== 1) throw new Error("The source order changed or became unavailable.");
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.getByRole("button", { name: "Копия", exact: true }).click();
  const desktopDialog = page.getByRole("dialog", { name: /^Копия заказа / });
  await page.waitForTimeout(450);
  const desktopDialogBox = await desktopDialog.boundingBox();
  if (!desktopDialogBox || desktopDialogBox.x < -1 || desktopDialogBox.x + desktopDialogBox.width > 3841) {
    throw new Error(`Copy dialog overflows the 4K viewport: ${JSON.stringify(desktopDialogBox)}`);
  }
  await desktopDialog.getByRole("button", { name: "Закрыть окно" }).click();
  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
  process.stdout.write(`${JSON.stringify({ sourcePath, copiedPath, sourceHeading, copiedHeading })}\n`);
} finally {
  await browser.close();
}
