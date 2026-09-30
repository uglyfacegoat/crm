import "./require-flow-check-target.mjs";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browserPaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
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
  ["/", "dashboard-workflow.png"],
  ["/quick-order", "order-workflow.png"],
  ["/clients", "clients-workflow.png"],
  ["/calendar", "calendar-workflow.png"],
  ["/masters", "masters-workflow.png"],
  ["/documents/archive", "documents-archive-workflow.png"],
  ["/finance", "finance-workflow.png"],
  ["/tasks", "tasks-workflow.png"],
  ["/analytics", "analytics-workflow.png"],
  ["/inbox", "inbox-workflow.png"],
  ["/sites", "sites-workflow.png"],
  ["/companies", "companies-workflow.png"],
  ["/mail", "mail-workflow.png"],
  ["/contracts", "contracts-workflow.png"],
  ["/chat", "chat-workflow.png"],
  ["/notifications", "notifications-workflow.png"],
  ["/profile", "profile-workflow.png"],
  ["/settings", "settings-workflow.png"],
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
    await page.goto(`${baseUrl}${path}`, { waitUntil: path === "/chat" ? "domcontentloaded" : "networkidle" });
    if (path === "/chat") await page.waitForTimeout(1200);
    if (path === "/chat") await page.addStyleTag({ content: '[role="status"] { display: none !important; }' });
    if (path === "/companies") {
      await page.getByRole("button", { name: /BioSave/ }).click();
    }
    const state = await page.evaluate(() => ({
      contentLength: document.body.innerText.trim().length,
      invalidHost: document.body.innerText.includes('"invalid_host"'),
      hasErrorOverlay: Boolean(
        document.querySelector(
          "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
        ),
      ),
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    }));
    if (state.contentLength < 100 || state.invalidHost || new URL(page.url()).pathname !== path)
      throw new Error(`${path} rendered a blank page.`);
    if (state.hasErrorOverlay)
      throw new Error(`${path} rendered an error overlay.`);
    if (state.horizontalOverflow) {
      throw new Error(`${path} has viewport-level horizontal overflow.`);
    }
    await page.screenshot({ path: resolve(outputDirectory, filename) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: '[role="status"] { display: none !important; }' });
  await page.screenshot({ path: resolve(outputDirectory, "chat-mobile-workflow.png") });
} finally {
  await context.close();
  await browser.close();
}

if (browserErrors.length) {
  throw new Error(`Browser errors:\n${browserErrors.join("\n")}`);
}

console.log(`Verified and captured ${screenshots.length} help screenshots.`);
