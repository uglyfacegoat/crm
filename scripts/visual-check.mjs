import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const defaultBrowserPaths = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"],
};

const visualCases = [
  { name: "dashboard-4k", path: "/", width: 3840, height: 2160 },
  { name: "dashboard-desktop", path: "/", width: 1920, height: 1080 },
  { name: "dashboard-laptop", path: "/", width: 1366, height: 768 },
  { name: "dashboard-tablet", path: "/", width: 768, height: 1024 },
  { name: "dashboard-mobile", path: "/", width: 390, height: 844 },
  { name: "dashboard-compact", path: "/", width: 320, height: 568 },
  { name: "dashboard-micro", path: "/", width: 280, height: 653 },
  { name: "orders-4k", path: "/orders", width: 3840, height: 2160 },
  { name: "orders-tablet", path: "/orders", width: 1024, height: 768 },
  { name: "orders-compact", path: "/orders", width: 320, height: 568 },
  { name: "order-create-dialog-desktop", path: "/orders", width: 1920, height: 1080, openOrderDialog: true },
  { name: "order-create-dialog-mobile", path: "/orders", width: 320, height: 568, openOrderDialog: true },
  { name: "clients-mobile", path: "/clients", width: 360, height: 800 },
  { name: "clients-dialog-desktop", path: "/clients", width: 1920, height: 1080, openClientDialog: true },
  { name: "clients-dialog-mobile", path: "/clients", width: 320, height: 568, openClientDialog: true },
  { name: "client-detail-desktop", path: "/clients/cl-1", width: 1920, height: 1080 },
  { name: "client-detail-4k", path: "/clients/cl-1", width: 3840, height: 2160 },
  { name: "client-detail-mobile", path: "/clients/cl-1", width: 320, height: 568 },
  { name: "client-object-dialog-mobile", path: "/clients/cl-1", width: 360, height: 800, openObjectDialog: true },
  { name: "calendar-mobile", path: "/calendar", width: 390, height: 844 },
  { name: "calendar-list-desktop", path: "/calendar", width: 1920, height: 1080, openCalendarList: true },
  { name: "calendar-list-mobile", path: "/calendar", width: 320, height: 568, openCalendarList: true },
  { name: "documents-mobile", path: "/documents", width: 360, height: 800 },
  { name: "documents-desktop", path: "/documents", width: 1920, height: 1080 },
  { name: "masters-4k", path: "/masters", width: 3840, height: 2160 },
  { name: "tasks-tablet", path: "/tasks", width: 768, height: 1024 },
  { name: "tasks-desktop", path: "/tasks", width: 1920, height: 1080 },
  { name: "order-4k", path: "/orders/ord-1248", width: 3840, height: 2160 },
  { name: "order-compact", path: "/orders/ord-1248", width: 320, height: 568 },
  { name: "order-relations-dialog-desktop", path: "/orders/ord-1248", width: 1920, height: 1080, openOrderRelationsDialog: true },
  { name: "order-relations-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openOrderRelationsDialog: true },
  { name: "order-edit-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openOrderEditDialog: true },
  { name: "visit-create-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitDialog: true },
  { name: "visit-series-dialog-desktop", path: "/orders/ord-1248", width: 1920, height: 1080, openVisitSeriesDialog: true },
  { name: "visit-series-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitSeriesDialog: true },
  { name: "visit-edit-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitEditDialog: true },
  { name: "analytics-4k", path: "/analytics", width: 3840, height: 2160 },
  { name: "analytics-mobile", path: "/analytics", width: 320, height: 568 },
  { name: "sites-desktop", path: "/sites", width: 1920, height: 1080 },
  { name: "sites-micro", path: "/sites", width: 280, height: 653 },
  { name: "settings-desktop", path: "/settings", width: 1920, height: 1080 },
  { name: "settings-mobile", path: "/settings", width: 320, height: 568 },
  { name: "login-4k", path: "/login", width: 3840, height: 2160 },
  { name: "login-micro", path: "/login", width: 280, height: 653 },
];

const configuredBrowserPath = process.env.CHROME_PATH;
const browserPath = configuredBrowserPath ?? defaultBrowserPaths[process.platform]?.find(existsSync);

if (!browserPath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to a Chromium executable.");
}

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:3000";
const outputDirectory = resolve("artifacts/visual");
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const failures = [];

try {
  for (const visualCase of visualCases) {
    const page = await browser.newPage({
      viewport: { width: visualCase.width, height: visualCase.height },
      deviceScaleFactor: 1,
      colorScheme: "dark",
      reducedMotion: "reduce",
    });

    page.on("pageerror", (error) => failures.push(`${visualCase.name}: page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`${visualCase.name}: console error: ${message.text()}`);
    });

    await page.goto(`${baseUrl}${visualCase.path}`, { waitUntil: "networkidle" });
    if (visualCase.openClientDialog) {
      await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый клиент" }).waitFor();
    }
    if (visualCase.openObjectDialog) {
      await page.getByRole("button", { name: "Новый объект", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый объект" }).waitFor();
    }
    if (visualCase.openOrderDialog) {
      await page.getByRole("button", { name: "Новый заказ", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый заказ" }).waitFor();
    }
    if (visualCase.openOrderEditDialog) {
      await page.getByRole("button", { name: "Редактировать", exact: true }).click();
      await page.getByRole("dialog", { name: "Редактировать заказ" }).waitFor();
    }
    if (visualCase.openVisitDialog) {
      await page.getByRole("button", { name: "Добавить выезд", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый выезд" }).waitFor();
    }
    if (visualCase.openVisitSeriesDialog) {
      await page.getByRole("button", { name: "Создать серию выездов", exact: true }).click();
      await page.getByRole("dialog", { name: "Серия выездов" }).waitFor();
    }
    if (visualCase.openVisitEditDialog) {
      await page.getByRole("button", { name: /Редактировать выезд/ }).first().click();
      await page.getByRole("dialog", { name: "Редактировать выезд" }).waitFor();
    }
    if (visualCase.openOrderRelationsDialog) {
      await page.getByRole("button", { name: "Связать заказ", exact: true }).click();
      await page.getByRole("dialog", { name: "Связать заказы" }).waitFor();
    }
    if (visualCase.openCalendarList) {
      await page.getByRole("button", { name: "Список", exact: true }).click();
      await page.getByRole("heading", { name: "Расписание всех заказов" }).waitFor();
    }

    const viewportState = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));

    if (viewportState.documentWidth > viewportState.viewportWidth) {
      failures.push(`${visualCase.name}: horizontal overflow ${viewportState.documentWidth}px > ${viewportState.viewportWidth}px`);
    }

    await page.screenshot({ path: resolve(outputDirectory, `${visualCase.name}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures.length > 0) {
  throw new Error(`Visual checks failed:\n${failures.join("\n")}`);
}

console.log(`Captured ${visualCases.length} viewports without horizontal overflow in ${outputDirectory}`);
