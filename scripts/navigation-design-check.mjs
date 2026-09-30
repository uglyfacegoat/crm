import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://localhost:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!identity || !password) throw new Error("UI audit credentials are required.");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
mkdirSync("artifacts/design", { recursive: true });

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }
  const nav = page.getByRole("navigation", { name: "Основная навигация" });
  const orders = nav.getByRole("button", { name: "Заказы", exact: true });
  assert.equal(await orders.getAttribute("aria-expanded"), "true");
  await orders.click();
  assert.equal(await nav.getByRole("link", { name: "Все заказы", exact: true }).count(), 0);
  await orders.focus();
  await page.keyboard.press("Enter");
  assert.equal(await orders.getAttribute("aria-expanded"), "true");
  await nav.getByRole("link", { name: "Все заказы", exact: true }).click();
  await page.waitForURL("**/orders");
  assert.equal(await nav.getByRole("link", { name: "Все заказы", exact: true }).getAttribute("aria-current"), "page");
  await page.getByRole("button", { name: "Свернуть меню", exact: true }).click();
  assert.equal(await nav.getByRole("link", { name: "Заказы", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Развернуть меню", exact: true }).click();

  const team = nav.getByRole("button", { name: "Команда", exact: true });
  const documents = nav.getByRole("button", { name: "Документы", exact: true });
  await team.click();
  await documents.click();
  await nav.getByRole("link", { name: "Мастера", exact: true }).click();
  await page.waitForURL("**/masters");
  assert.equal(await team.getAttribute("aria-expanded"), "true", "Team must remain open after navigation");
  assert.equal(await documents.getAttribute("aria-expanded"), "true", "Other open groups must remain open");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await team.getAttribute("aria-expanded"), "true", "Team must remain open after reload");
  assert.equal(await documents.getAttribute("aria-expanded"), "true", "Documents must remain open after reload");
  await documents.click();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await documents.getAttribute("aria-expanded"), "false", "Closed preference must survive reload");
  const secondPage = await context.newPage();
  await secondPage.goto(baseUrl, { waitUntil: "networkidle" });
  await secondPage.getByRole("navigation", { name: "Основная навигация" }).getByRole("button", { name: "Документы", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('nav[aria-label="Основная навигация"] button')].some((button) => button.textContent === "Документы" && button.getAttribute("aria-expanded") === "true"));
  await secondPage.close();

  let checked = 0;
  for (const theme of ["light", "dark"]) {
    await context.addCookies([{ name: "crm_appearance_theme", value: theme, url: baseUrl }]);
    for (const width of [1440, 1366, 390]) {
      await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
      for (const [name, route] of [
        ["dashboard", "/"], ["orders", "/orders"], ["inbox", "/inbox"], ["quick-order", "/quick-order"],
        ["clients", "/clients"], ["calendar", "/calendar"], ["masters", "/masters"],
        ["documents", "/documents"], ["archive", "/documents/archive"], ["contracts", "/contracts"],
        ["finance", "/finance"], ["tasks", "/tasks"], ["workflow", "/workflow"], ["analytics", "/analytics"],
        ["sites", "/sites"], ["companies", "/companies"], ["notifications", "/notifications"],
        ["chat", "/chat"], ["settings", "/settings"], ["help", "/help"],
      ]) {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
        assert.equal(response.status(), 200, `${route} HTTP status`);
        assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${route}: overflow at ${width}`);
        const invalidPanels = await page.locator(".surface-panel").evaluateAll((panels) => panels.filter((panel) => {
          const style = getComputedStyle(panel);
          return style.display !== "none" && (parseFloat(style.borderTopWidth) !== 5 || parseFloat(style.borderTopLeftRadius) <= 0);
        }).length);
        assert.equal(invalidPanels, 0, `${route}: inconsistent panel frame`);
        const sharpInnerPanels = await page.locator(".panel-stack > :not(:first-child), .dashboard-panel > :not(:first-child)").evaluateAll((blocks) => blocks.filter((block) => {
          const style = getComputedStyle(block);
          return block.getBoundingClientRect().width > 0 && [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some((radius) => parseFloat(radius) === 0);
        }).length);
        assert.equal(sharpInnerPanels, 0, `${route}: inner panels must have four rounded corners`);
        if (name === "tasks") {
          const emptyStates = page.getByText("В этом разделе задач нет", { exact: true });
          assert.ok(await emptyStates.evaluateAll((messages) => messages.every((message) => message.parentElement.parentElement.classList.contains("panel-stack") && message.parentElement.parentElement.children.length === 2)), "Empty task columns must have one content panel");
        }
        if (name === "dashboard") {
          const chart = page.getByRole("region", { name: "Как движется работа", exact: true });
          if (width >= 768) {
            const days = chart.locator(".dashboard-activity-grid > button");
            assert.equal(await days.count(), 30);
            await days.first().click();
            assert.equal(await days.first().getAttribute("aria-pressed"), "true");
            const cellSizes = await chart.locator("[data-activity-cell]").evaluateAll((cells) => cells.map((cell) => {
              const { width, height } = cell.getBoundingClientRect();
              return { width, height };
            }));
            assert.equal(cellSizes.length, 360);
            assert.ok(cellSizes.every(({ width, height }) => width > 0 && Math.abs(width - height) < 1), "Activity cells must be square");
          } else {
            const days = chart.locator(".dashboard-activity-mobile-grid > button");
            assert.equal(await days.count(), 30);
            await days.first().click();
            assert.equal(await days.first().getAttribute("data-active"), "true");
          }
          const squareCorners = await page.locator(".dashboard-panel > :not(:first-child)").evaluateAll((blocks) => blocks.filter((block) => {
            const style = getComputedStyle(block);
            return style.display !== "none" && [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomLeftRadius, style.borderBottomRightRadius].some((radius) => parseFloat(radius) === 0);
          }).length);
          assert.equal(squareCorners, 0, "White dashboard blocks must have four rounded corners");
        }
        if (width >= 768) {
          assert.equal(await page.locator("aside").getByRole("button", { name: "Выйти", exact: true }).count(), 0, "Sidebar must not duplicate profile actions");
          await page.getByRole("button", { name: "Открыть меню профиля", exact: true }).click();
          assert.equal(await page.getByRole("menuitem", { name: "Выйти", exact: true }).count(), 1, "Logout must remain available in the profile menu");
          await page.keyboard.press("Escape");
        }
        await page.screenshot({ path: `artifacts/design/${name}-${theme}-${width}.png`, fullPage: true });
        checked++;
        if (name === "settings") {
          const tabs = page.getByRole("tab");
          for (let index = 0; index < await tabs.count(); index++) {
            await tabs.nth(index).click();
            await page.getByRole("tabpanel").waitFor();
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Settings tab ${index} overflows at ${width}`);
            await page.screenshot({ path: `artifacts/design/settings-tab-${index}-${theme}-${width}.png`, fullPage: true });
            checked++;
          }
        }
      }
    }
  }
  await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
  const mobileNav = page.getByRole("navigation", { name: "Основная навигация" });
  assert.equal(await mobileNav.getByRole("button", { name: "Документы", exact: true }).getAttribute("aria-expanded"), "true", "Mobile menu must share expanded state");
  await mobileNav.getByRole("link", { name: "Договоры", exact: true }).click();
  await page.waitForURL("**/contracts");
  assert.equal(await page.getByRole("button", { name: "Закрыть меню", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checked, errors, navigation: "desktop, collapsed, keyboard and mobile passed" }));
} finally {
  await browser.close();
}
