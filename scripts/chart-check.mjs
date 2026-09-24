import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
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

try {
  await openProtectedPage("/analytics?range=30&data=example");
  await page.locator(".analytics-money-plot").waitFor();
  const analytics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    barGroups: document.querySelectorAll(".analytics-bars-desktop .analytics-bar-group").length,
    visibleBars: Array.from(document.querySelectorAll(".analytics-bars-desktop .analytics-bar-pair > span")).filter((bar) => bar.getBoundingClientRect().height > 0).length,
    treemapCells: document.querySelectorAll(".analytics-treemap .analytics-tree-cell").length,
    heatCells: document.querySelectorAll(".analytics-heat-grid > span").length,
    nativeTitles: document.querySelectorAll(".analytics-figma-layout [title]").length,
    demoBanners: document.querySelectorAll(".figma-report-demo").length,
    dateLabels: Array.from(document.querySelectorAll(".analytics-bars-desktop .analytics-bar-group small"), (label) => label.textContent?.trim() ?? ""),
  }));
  if (analytics.documentWidth > analytics.viewportWidth) throw new Error(`Analytics overflows horizontally: ${analytics.documentWidth}px.`);
  if (analytics.barGroups < 6 || analytics.visibleBars < 6 || analytics.treemapCells < 3 || analytics.heatCells < 28 || analytics.nativeTitles || analytics.demoBanners) throw new Error(`Analytics charts are incomplete: ${JSON.stringify(analytics)}`);
  if (analytics.dateLabels.length < 3 || JSON.stringify(analytics.dateLabels.slice(0, 3)) === JSON.stringify(["1 авг", "17 авг", "30 авг"])) throw new Error(`Analytics dates are stale: ${JSON.stringify(analytics.dateLabels)}`);
  const exportResult = await page.evaluate(async () => {
    const response = await fetch("/api/v1/analytics/export?range=30");
    return { status: response.status, contentType: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"), body: await response.text() };
  });
  if (exportResult.status !== 200 || !exportResult.contentType?.startsWith("text/csv") || !exportResult.disposition?.includes("attachment") || !exportResult.body.includes("Отчёт CRM")) throw new Error(`Analytics export is invalid: ${JSON.stringify(exportResult)}`);

  await openProtectedPage("/sites?data=example");
  await page.locator(".site-traffic-chart .recharts-area-curve").waitFor();
  const sites = await page.evaluate(() => {
    const curve = document.querySelector(".site-traffic-chart .recharts-area-curve");
    const box = curve instanceof SVGGraphicsElement ? curve.getBBox() : null;
    return {
      curves: document.querySelectorAll(".site-traffic-chart .recharts-area-curve").length,
      areas: document.querySelectorAll(".site-traffic-chart .recharts-area-area").length,
      xTicks: document.querySelectorAll(".site-traffic-chart .recharts-xAxis .recharts-cartesian-axis-tick").length,
      yTicks: document.querySelectorAll(".site-traffic-chart .recharts-yAxis .recharts-cartesian-axis-tick").length,
      xTickLabels: Array.from(document.querySelectorAll(".site-traffic-chart .recharts-xAxis .recharts-cartesian-axis-tick text"), (label) => label.textContent?.trim() ?? ""),
      dash: curve?.getAttribute("stroke-dasharray") ?? "",
      box: box ? { width: box.width, height: box.height } : null,
      demoBanners: document.querySelectorAll(".figma-report-demo").length,
    };
  });
  if (sites.curves !== 1 || sites.areas !== 1 || sites.xTicks !== 3 || sites.yTicks !== 3 || sites.dash || !sites.box || sites.box.width < 300 || sites.box.height < 30 || sites.demoBanners) throw new Error(`Site traffic chart is invalid: ${JSON.stringify(sites)}`);
  if (JSON.stringify(sites.xTickLabels) === JSON.stringify(["19 авг", "1 сен", "17 сен"])) throw new Error(`Site traffic dates are stale: ${JSON.stringify(sites.xTickLabels)}`);
  const trafficChartBox = await page.locator(".site-traffic-chart").boundingBox();
  if (!trafficChartBox) throw new Error("Site traffic chart is not visible.");
  await page.mouse.move(trafficChartBox.x + trafficChartBox.width / 2, trafficChartBox.y + trafficChartBox.height / 2);
  const tooltip = page.locator(".site-traffic-chart .recharts-tooltip-wrapper");
  await tooltip.waitFor({ state: "visible" });
  const siteTooltip = await tooltip.evaluate((element) => {
    const content = element.firstElementChild;
    if (!(content instanceof HTMLElement)) return null;
    const styles = getComputedStyle(content);
    return {
      text: content.textContent?.trim() ?? "",
      backgroundColor: styles.backgroundColor,
      color: getComputedStyle(content.querySelector("strong") ?? content).color,
    };
  });
  if (!siteTooltip?.text.includes("посетителей") || siteTooltip.backgroundColor !== "rgb(255, 255, 255)" || siteTooltip.color === "rgb(255, 255, 255)") throw new Error(`Site traffic tooltip is invalid: ${JSON.stringify(siteTooltip)}`);

  await openProtectedPage("/");
  await page.locator("[data-activity-cell]").first().waitFor();
  const dashboard = await page.evaluate(() => {
    const row = document.querySelector(".dashboard-operational-row")?.getBoundingClientRect();
    const panels = Array.from(document.querySelectorAll(".dashboard-operational-row > div"), (element) => element.getBoundingClientRect());
    return {
      activityCells: document.querySelectorAll("[data-activity-cell]").length,
      activityDays: document.querySelectorAll(".dashboard-activity-grid > button").length,
      operationalRow: row ? { left: row.left, right: row.right, width: row.width } : null,
      operationalPanels: panels.map((panel) => ({ left: panel.left, right: panel.right, width: panel.width })),
    };
  });
  if (dashboard.activityDays < 28 || dashboard.activityCells !== dashboard.activityDays * 12) throw new Error(`Dashboard activity chart is invalid: ${JSON.stringify(dashboard)}`);
  if (!dashboard.operationalRow || dashboard.operationalPanels.length !== 2 || Math.abs(dashboard.operationalPanels.at(-1).right - dashboard.operationalRow.right) > 2) throw new Error(`Dashboard operational panels do not fill the row: ${JSON.stringify(dashboard)}`);

  if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
  console.log(JSON.stringify({
    analytics,
    sites: { ...sites, tooltip: siteTooltip },
    dashboard,
    export: { ...exportResult, body: `${exportResult.body.length} characters` },
  }, null, 2));
} finally {
  await browser.close();
}
