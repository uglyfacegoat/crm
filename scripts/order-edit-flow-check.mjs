import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.ORDER_EDIT_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.ORDER_EDIT_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.ORDER_EDIT_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const configuredOrderId = process.env.ORDER_EDIT_CHECK_ORDER_ID;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("ORDER_EDIT_CHECK_IDENTITY and ORDER_EDIT_CHECK_PASSWORD are required.");

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

  let orderPath;
  if (configuredOrderId) {
    orderPath = `/orders/${configuredOrderId}`;
    await page.goto(`${baseUrl}${orderPath}`, { waitUntil: "networkidle" });
  } else {
    const orderLink = page.locator('a[href^="/orders/"]:visible').first();
    await orderLink.waitFor();
    orderPath = await orderLink.getAttribute("href");
    if (!orderPath) throw new Error("No editable order was found.");
    await orderLink.click();
    await page.waitForURL(`${baseUrl}${orderPath}`);
  }

  const suffix = String(Date.now()).slice(-6);
  const serviceName = `Проверочная услуга ${suffix}`;
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  await dialog.getByRole("button", { name: "Услуга", exact: true }).click();
  const serviceNames = dialog.locator('input[aria-label^="Название услуги"]');
  const serviceQuantities = dialog.locator('input[aria-label^="Количество услуги"]');
  const servicePrices = dialog.locator('input[aria-label^="Цена услуги"]');
  const addedIndex = await serviceNames.count() - 1;
  await serviceNames.nth(addedIndex).fill(serviceName);
  await serviceQuantities.nth(addedIndex).fill("1.5");
  await servicePrices.nth(addedIndex).fill("1234.50");
  await dialog.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByText(serviceName, { exact: true }).waitFor();

  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const desktopDialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  await page.waitForTimeout(450);
  const desktopDialogBox = await desktopDialog.boundingBox();
  if (!desktopDialogBox || desktopDialogBox.x < -1 || desktopDialogBox.x + desktopDialogBox.width > 3841) {
    throw new Error(`Edit dialog overflows the 4K viewport: ${JSON.stringify(desktopDialogBox)}`);
  }
  const persistedServiceInputs = desktopDialog.locator('input[aria-label^="Название услуги"]');
  let editedServicePersisted = false;
  for (let index = 0; index < await persistedServiceInputs.count(); index += 1) {
    if (await persistedServiceInputs.nth(index).inputValue() === serviceName) editedServicePersisted = true;
  }
  if (!editedServicePersisted) throw new Error(`Edited service was not persisted: ${serviceName}`);
  await desktopDialog.getByRole("button", { name: "Закрыть окно" }).click();
  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
  process.stdout.write(`${JSON.stringify({ orderPath, serviceName })}\n`);
} finally {
  await browser.close();
}
