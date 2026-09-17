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

async function openProtectedPage(path) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  if (!page.url().includes("/login")) return;
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  if (!page.url().endsWith(path)) await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
}

async function readChartDiagnostics() {
  return page.evaluate(() => {
    const describePaths = (selector) => Array.from(document.querySelectorAll(selector), (path) => {
      const box = path.getBBox();
      return { d: path.getAttribute("d"), box: { x: box.x, y: box.y, width: box.width, height: box.height } };
    });
    return {
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      containers: Array.from(document.querySelectorAll(".recharts-responsive-container"), (chart) => {
        const box = chart.getBoundingClientRect();
        return { width: box.width, height: box.height };
      }),
      areas: describePaths(".recharts-area-curve"),
      pieSectors: describePaths(".recharts-pie-sector path"),
    };
  });
}

function assertValidPaths(paths, minimum, label) {
  if (paths.length < minimum || paths.some((path) => !path.d || path.d.includes("NaN"))) {
    throw new Error(`${label} paths are invalid: ${JSON.stringify(paths)}`);
  }
}

try {
  await openProtectedPage("/analytics?range=30");
  await page.locator(".recharts-responsive-container").first().waitFor();
  const analytics = await readChartDiagnostics();
  if (analytics.documentWidth > analytics.viewportWidth) throw new Error(`Analytics overflows horizontally: ${analytics.documentWidth}px.`);
  if (!analytics.containers[0] || analytics.containers[0].height < 288) throw new Error(`Trend chart is too short: ${JSON.stringify(analytics.containers[0])}`);
  assertValidPaths(analytics.areas, 3, "Analytics trend");
  const exportResult = await page.evaluate(async () => {
    const response = await fetch("/api/v1/analytics/export?range=30");
    return { status: response.status, contentType: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), body: await response.text() };
  });
  if (exportResult.status !== 200 || !exportResult.contentType?.startsWith("text/csv") || !exportResult.disposition?.includes("attachment") || !exportResult.body.includes("Отчёт CRM")) throw new Error(`Analytics export is invalid: ${JSON.stringify(exportResult)}`);

  await openProtectedPage("/tasks");
  await page.locator(".recharts-responsive-container").first().waitFor();
  const tasks = await readChartDiagnostics();
  assertValidPaths(tasks.pieSectors, 2, "Task distribution");

  await openProtectedPage("/sites");
  await page.locator(".recharts-responsive-container").first().waitFor();
  const sites = await readChartDiagnostics();
  assertValidPaths(sites.areas, 1, "Site traffic trend");
  assertValidPaths(sites.pieSectors, 2, "Site lead sources");

  await openProtectedPage("/");
  await page.locator(".recharts-responsive-container").first().waitFor();
  const dashboard = await readChartDiagnostics();
  assertValidPaths(dashboard.areas, 4, "Dashboard sparklines");

  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  console.log(JSON.stringify({
    analytics: { charts: analytics.containers.length, paths: analytics.areas.length },
    tasks: { charts: tasks.containers.length, sectors: tasks.pieSectors.length },
    sites: { charts: sites.containers.length, paths: sites.areas.length, sectors: sites.pieSectors.length },
    dashboard: { charts: dashboard.containers.length, paths: dashboard.areas.length },
    export: { ...exportResult, body: `${exportResult.body.length} characters` },
  }, null, 2));
} finally {
  await browser.close();
}
