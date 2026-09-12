import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browserPaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const browserPath = process.env.CHROME_PATH ?? browserPaths.find(existsSync);
if (!browserPath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
}

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:6767";
const identity =
  process.env.VISUAL_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password =
  process.env.VISUAL_CHECK_PASSWORD ??
  process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const screenshots = [
  ["/quick-order", "order-workflow.png"],
  ["/clients", "clients-workflow.png"],
  ["/calendar", "calendar-workflow.png"],
  ["/masters", "masters-workflow.png"],
  ["/documents/archive", "documents-archive-workflow.png"],
  ["/finance", "finance-workflow.png"],
  ["/tasks", "tasks-workflow.png"],
  ["/analytics", "analytics-workflow.png"],
  ["/inbox", "inbox-workflow.png"],
  ["/companies", "companies-workflow.png"],
];
const outputDirectory = resolve("public/help");
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    const previewEntry = page.getByRole("button", {
      name: "Открыть CRM",
      exact: true,
    });
    if ((await previewEntry.count()) && (await previewEntry.isVisible())) {
      await previewEntry.click();
    } else if (identity && password) {
      await page.getByPlaceholder("Email или телефон").fill(identity);
      await page.getByPlaceholder("Пароль").fill(password);
      await page
        .getByRole("button", { name: "Войти в CRM", exact: true })
        .click();
    } else {
      throw new Error(
        "Screenshot checks require visual-check login credentials.",
      );
    }
    await page.waitForURL((url) => url.pathname !== "/login");
  }

  for (const [path, filename] of screenshots) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    if (path === "/companies") {
      await page.getByRole("button", { name: /BioSave/ }).click();
    }
    const state = await page.evaluate(() => ({
      contentLength: document.body.innerText.trim().length,
      hasErrorOverlay: Boolean(
        document.querySelector(
          "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
        ),
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    }));
    if (state.contentLength === 0)
      throw new Error(`${path} rendered a blank page.`);
    if (state.hasErrorOverlay)
      throw new Error(`${path} rendered an error overlay.`);
    if (state.horizontalOverflow) {
      throw new Error(`${path} has viewport-level horizontal overflow.`);
    }
    await page.screenshot({ path: resolve(outputDirectory, filename) });
  }
} finally {
  await context.close();
  await browser.close();
}

if (browserErrors.length) {
  throw new Error(`Browser errors:\n${browserErrors.join("\n")}`);
}

console.log(`Verified and captured ${screenshots.length} help screenshots.`);
