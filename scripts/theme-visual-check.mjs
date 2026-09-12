import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browserPaths = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const browserPath = process.env.CHROME_PATH ?? browserPaths.find(existsSync);
if (!browserPath)
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:6767";
const identity =
  process.env.VISUAL_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password =
  process.env.VISUAL_CHECK_PASSWORD ??
  process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const outputDirectory = resolve("artifacts/visual");
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  colorScheme: "dark",
  reducedMotion: "reduce",
});
await context.addCookies([
  { name: "crm_appearance_theme", value: "dark", url: baseUrl },
]);
const page = await context.newPage();
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") failures.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    const previewEntry = page.getByRole("button", {
      name: "Открыть CRM",
      exact: true,
    });
    if (await previewEntry.count()) {
      await previewEntry.click();
    } else {
      if (!identity || !password)
        throw new Error("Visual-check credentials are missing.");
      await page.getByPlaceholder("Email или телефон").fill(identity);
      await page.getByPlaceholder("Пароль").fill(password);
      await page
        .getByRole("button", { name: "Войти в CRM", exact: true })
        .click();
    }
    await page.waitForURL((url) => url.pathname !== "/login");
  }

  await page.goto(`${baseUrl}/settings`, { waitUntil: "networkidle" });
  const memberPath = await page
    .locator('a[href^="/settings/users/"]')
    .first()
    .getAttribute("href");
  await page.goto(`${baseUrl}/contracts`, { waitUntil: "networkidle" });
  const contractPath = await page
    .locator('a[href^="/contracts/"]')
    .first()
    .getAttribute("href");
  if (!memberPath)
    failures.push("Settings did not expose a member detail route.");
  if (!contractPath) failures.push("Contracts did not expose a detail route.");

  const routes = [
    ["dark-dashboard", "/"],
    ["dark-masters", "/masters"],
    ["dark-finance", "/finance"],
    ["dark-settings", "/settings"],
    ...(memberPath ? [["dark-member", memberPath]] : []),
    ...(contractPath ? [["dark-contract", contractPath]] : []),
  ];

  for (const [name, path] of routes) {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
    const firstFocusable = page.locator("button, a, input").first();
    await firstFocusable.focus();
    const state = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const focused = document.activeElement
        ? getComputedStyle(document.activeElement)
        : null;
      return {
        theme: document.documentElement.dataset.theme,
        canvas: root.getPropertyValue("--canvas").trim(),
        surface: root.getPropertyValue("--surface").trim(),
        bodyLength: document.body.innerText.trim().length,
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
        errorOverlay: Boolean(document.querySelector("[data-nextjs-dialog]")),
        focusShadow: focused?.boxShadow ?? null,
        focusOffset: focused?.outlineOffset ?? null,
      };
    });
    if (state.theme !== "dark")
      failures.push(`${path}: dark theme was not applied.`);
    if (state.canvas !== "#191b1f" || state.surface !== "#25272c") {
      failures.push(`${path}: unexpected dark palette tokens.`);
    }
    if (!state.bodyLength || state.overflow || state.errorOverlay) {
      failures.push(
        `${path}: invalid rendered state ${JSON.stringify(state)}.`,
      );
    }
    if (state.focusShadow !== "none" || state.focusOffset !== "-2px") {
      failures.push(`${path}: focus styling still creates an external glow.`);
    }
    await page.screenshot({ path: resolve(outputDirectory, `${name}.png`) });
  }
} finally {
  await context.close();
  await browser.close();
}

if (failures.length)
  throw new Error(`Dark theme checks failed:\n${failures.join("\n")}`);
console.log(
  "Verified dark palette, focus treatment, rendering and key desktop routes.",
);
