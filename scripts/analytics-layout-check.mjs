import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://localhost:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;

if (!identity || !password) throw new Error("Analytics layout check credentials are required.");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 2048, height: 1080 }, reducedMotion: "reduce" });
const page = await context.newPage();
const browserErrors = [];

page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});

mkdirSync("artifacts/analytics", { recursive: true });

async function signIn() {
  await page.goto(baseUrl + "/analytics", { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/login") return;
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
  if (new URL(page.url()).pathname !== "/analytics") {
    await page.goto(baseUrl + "/analytics", { waitUntil: "networkidle" });
  }
}

function assertRectInsideViewport(rect, label, viewportWidth) {
  assert.ok(rect.width > 0, `${label} must have width`);
  assert.ok(rect.x >= -1, `${label} starts outside the viewport`);
  assert.ok(rect.x + rect.width <= viewportWidth + 1, `${label} overflows the viewport`);
}

function assertCardsDoNotOverlap(rects, label) {
  for (let firstIndex = 0; firstIndex < rects.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < rects.length; secondIndex += 1) {
      const first = rects[firstIndex];
      const second = rects[secondIndex];
      const horizontalOverlap = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
      const verticalOverlap = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
      assert.ok(horizontalOverlap <= 1 || verticalOverlap <= 1, `${label} cards ${firstIndex + 1} and ${secondIndex + 1} overlap`);
    }
  }
}

try {
  await signIn();
  const viewports = [
    { width: 2048, height: 1080 },
    { width: 1440, height: 960 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl + "/analytics", { waitUntil: "networkidle" });
      assert.equal(await page.getByRole("navigation", { name: "Разделы аналитики" }).count(), 0, "Analytics must render as one page without view navigation");
      const viewContent = page.locator(".analytics-figma-layout");
      await viewContent.waitFor();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => window.scrollTo(0, 0));

      const cards = viewContent.locator(".figma-report-panel:visible");
      const cardCount = await cards.count();
      assert.ok(cardCount >= 6, `Analytics must render every report card at ${viewport.width}px`);

      const mainRect = await page.locator("main.workspace-main").boundingBox();
      assert.ok(mainRect, `Analytics main region is missing at ${viewport.width}px`);
      const cardRects = [];
      for (let index = 0; index < cardCount; index += 1) {
        const rect = await cards.nth(index).boundingBox();
        assert.ok(rect, `Analytics card ${index + 1} is missing at ${viewport.width}px`);
        assertRectInsideViewport(rect, `Analytics card ${index + 1} at ${viewport.width}px`, viewport.width);
        const minimumCardWidth = Math.min(320, Math.max(240, mainRect.width * 0.25));
        assert.ok(rect.width >= minimumCardWidth, `Analytics card ${index + 1} collapsed to ${Math.round(rect.width)}px at ${viewport.width}px`);
        cardRects.push({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
      }

      assertCardsDoNotOverlap(cardRects, `Analytics at ${viewport.width}px`);
      assert.equal(await cards.locator("[title]").count(), 0, "Analytics must not depend on native browser tooltips");
      const overflow = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
      assert.ok(overflow.documentWidth <= overflow.viewportWidth + 1, `Analytics has horizontal overflow at ${viewport.width}px: ${overflow.documentWidth}px document`);

      const tooltipTarget = viewContent.locator(".analytics-tree-cell").first();
      await tooltipTarget.hover();
      await page.waitForTimeout(160);
      assert.equal(await tooltipTarget.evaluate((element) => getComputedStyle(element, "::after").opacity), "1", "Custom chart tooltip must open on hover");
      await page.mouse.move(0, 0);

      const gridTemplateColumns = await viewContent.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
      if (viewport.width === 2048 || viewport.width === 390) {
        await page.screenshot({ path: `artifacts/analytics/all-${viewport.width}.png`, fullPage: true });
      }
      console.log(JSON.stringify({ viewport: viewport.width, mainWidth: Math.round(mainRect.width), gridTemplateColumns, cards: cardRects }));
  }

  await page.setViewportSize({ width: 2048, height: 1080 });
  await page.goto(baseUrl + "/analytics?range=30", { waitUntil: "networkidle" });
  assert.equal(await page.locator(".figma-report-demo").count(), 0, "Analytics must not render the removed demo-data banner");
  const periodText = await page.locator(".analytics-range-controls > span").innerText();
  const visibleDateLabels = await page.locator(".analytics-bars-desktop .analytics-bar-group small").allInnerTexts();
  assert.ok(visibleDateLabels.length >= 3, "Financial chart must expose date labels");
  assert.ok(periodText.includes("2026") || !periodText.includes("2025"), "Analytics period must describe the active date range");
  assert.notDeepEqual(visibleDateLabels.slice(0, 3), ["1 авг", "17 авг", "30 авг"], "Financial chart must not use the obsolete fixed August labels");

  assert.deepEqual(browserErrors, [], "Analytics browser errors");
  console.log("Single-page analytics layout passed at desktop, laptop, tablet and mobile widths.");
} finally {
  await context.close();
  await browser.close();
}
