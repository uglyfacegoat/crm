import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.CHART_CHECK_BASE_URL ?? "http://127.0.0.1:3000";
const identity = process.env.CHART_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.CHART_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Chart-check credentials are required.");

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "light", reducedMotion: "reduce" });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/analytics?range=30`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/analytics?range=30`);
  }
  await page.locator(".recharts-responsive-container").first().waitFor();
  const diagnostics = await page.evaluate(() => {
    const describePaths = (selector) => Array.from(document.querySelectorAll(selector), (path) => {
      const svgPath = path;
      const box = svgPath.getBBox();
      return { stroke: svgPath.getAttribute("stroke"), fill: svgPath.getAttribute("fill"), d: svgPath.getAttribute("d"), box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    });
    const chart = document.querySelector(".recharts-responsive-container");
    const chartBox = chart?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      chartBox: chartBox ? { width: chartBox.width, height: chartBox.height } : null,
      areas: describePaths(".recharts-area-curve"),
      pieSectors: describePaths(".recharts-pie-sector path"),
    };
  });
  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  if (diagnostics.documentWidth > diagnostics.viewportWidth) throw new Error(`Analytics overflows horizontally: ${diagnostics.documentWidth}px.`);
  if (!diagnostics.chartBox || diagnostics.chartBox.height < 288) throw new Error(`Trend chart is too short: ${JSON.stringify(diagnostics.chartBox)}`);
  if (diagnostics.areas.length < 3 || diagnostics.areas.some((area) => !area.d || area.d.includes("NaN"))) throw new Error(`Trend paths are invalid: ${JSON.stringify(diagnostics.areas)}`);
  if (diagnostics.pieSectors.length < 2 || diagnostics.pieSectors.some((sector) => !sector.d || sector.d.includes("NaN"))) throw new Error(`Pie sectors are invalid: ${JSON.stringify(diagnostics.pieSectors)}`);
  const exportResult = await page.evaluate(async () => {
    const response = await fetch("/api/v1/analytics/export?range=30");
    return { status: response.status, contentType: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), body: await response.text() };
  });
  if (exportResult.status !== 200 || !exportResult.contentType?.startsWith("text/csv") || !exportResult.disposition?.includes("attachment") || !exportResult.body.includes("Отчёт CRM")) throw new Error(`Analytics export is invalid: ${JSON.stringify(exportResult)}`);
  console.log(JSON.stringify({ ...diagnostics, export: { ...exportResult, body: `${exportResult.body.length} characters` } }, null, 2));
} finally {
  await browser.close();
}
