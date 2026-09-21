import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://localhost:3000";
const identity =
  process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password =
  process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!identity || !password)
  throw new Error("UI audit credentials are required.");
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
mkdirSync("artifacts/figma", { recursive: true });

async function capture(name) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    name + ": page overflow",
  );
  await page.screenshot({
    path: "artifacts/figma/" + name + ".png",
    fullPage: true,
  });
}

async function verifyModal(name) {
  const modal = page.getByRole("dialog", { name, exact: true });
  await modal.waitFor({ state: "visible" });
  const bounds = await modal.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(
    Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 2,
    "Modal must be horizontally centered",
  );
  assert.ok(
    Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2) < 2,
    "Modal must be vertically centered",
  );
  assert.ok(
    bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1,
    "Modal must fit viewport",
  );
  assert.ok(
    await modal.evaluate((element) => element.contains(document.activeElement)),
    "Initial focus must be inside modal",
  );
  const close = modal.getByRole("button", {
    name: "Закрыть окно",
    exact: true,
  });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  assert.ok(
    await modal.evaluate((element) => element.contains(document.activeElement)),
    "Focus must wrap inside modal",
  );
  const footerButtons = modal.locator("footer button");
  if (await footerButtons.count()) {
    await footerButtons.last().scrollIntoViewIfNeeded();
    const footerBounds = await footerButtons.last().boundingBox();
    assert.ok(
      footerBounds.y >= bounds.y &&
        footerBounds.y + footerBounds.height <= bounds.y + bounds.height + 1,
      "Footer action must be reachable by scrolling",
    );
  }
  await capture(name + "-" + viewport.width);
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page
      .getByRole("button", { name: "Войти в CRM", exact: true })
      .click();
    await page.waitForURL((url) => url.pathname !== "/login");
  }
  const unexpectedSubmissions = [];
  await page.route("**/quick-order", async (route) => {
    if (route.request().method() === "POST") {
      unexpectedSubmissions.push(route.request().url());
      await route.fulfill({
        status: 409,
        contentType: "text/plain",
        body: "UI verification does not permit order submission.",
      });
      return;
    }
    await route.continue();
  });
  let captures = 0;
  for (const theme of ["light", "dark"]) {
    await context.addCookies([
      { name: "crm_appearance_theme", value: theme, url: baseUrl },
    ]);
    for (const width of [320, 390, 834, 1080, 1440, 3840]) {
      await page.setViewportSize({ width, height: width >= 1440 ? 900 : 800 });
      for (const route of ["companies", "inbox", "quick-order", "finance"]) {
        const response = await page.goto(baseUrl + "/" + route, {
          waitUntil: "networkidle",
        });
        assert.equal(response.status(), 200);
        await capture(route + "-" + width + "-" + theme);
        captures++;
      }
    }
  }
  await context.addCookies([
    { name: "crm_appearance_theme", value: "light", url: baseUrl },
  ]);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(baseUrl + "/quick-order", { waitUntil: "networkidle" });
    const form = page.getByTestId("quick-order-form");
    await form
      .getByRole("button", { name: "Новый клиент", exact: true })
      .click();
    await page
      .getByTestId("quick-client-name")
      .fill("Проверка макета — не сохранять");
    await page.getByTestId("quick-tax-id").fill("7701234567");
    await page.getByTestId("quick-contact-name").fill("Проверка интерфейса");
    await page.getByTestId("quick-contact-phone").fill("+7 (999) 123-45-67");
    await page.getByTestId("quick-next").click();
    assert.ok(await page.locator("#quick-object-section").isVisible());
    await page.getByTestId("quick-object-name").fill("Тестовый объект");
    await page.getByTestId("quick-object-address").fill("Москва, Лесная, 12");
    await capture("quick-step-2-" + width);
    await page.getByTestId("quick-next").click();
    assert.ok(await page.locator("#quick-work-section").isVisible());
    await page.getByTestId("quick-unit-price").fill("12000");
    await capture("quick-step-3-" + width);
    await page.getByTestId("quick-next").click();
    assert.ok(await page.locator("#quick-visit-section").isVisible());
    await page.waitForTimeout(150);
    assert.deepEqual(
      unexpectedSubmissions,
      [],
      "Continue must not submit the order",
    );
    assert.ok(await page.getByTestId("quick-submit").isEnabled());
    await capture("quick-step-4-" + width);
    await page
      .getByRole("navigation", { name: "Маршрут оформления" })
      .getByRole("button", { name: /Клиент/ })
      .click();
    assert.equal(
      await page.getByTestId("quick-client-name").inputValue(),
      "Проверка макета — не сохранять",
      "Draft must survive navigation between steps",
    );
    // Do not submit: visual verification must not create customer records or financial entries.
    await page.goto(baseUrl + "/finance", { waitUntil: "networkidle" });
    const filterButton = page.getByRole("button", {
      name: "Фильтры",
      exact: true,
    });
    await filterButton.click();
    await verifyModal("Фильтры дебиторки");
    assert.ok(
      await filterButton.evaluate(
        (element) => element === document.activeElement,
      ),
      "Focus must return to trigger",
    );
    const firstOrder = page
      .locator("#finance-receivables-panel details")
      .first();
    if (await firstOrder.count()) {
      await firstOrder.locator("summary").click();
      assert.ok((await firstOrder.getAttribute("open")) !== null);
      await capture("finance-expanded-" + width);
      const payment = firstOrder
        .getByRole("button", { name: /Принять оплату/ })
        .first();
      if (await payment.count()) {
        await payment.click();
        const modal = page.locator(".modal-panel");
        await modal.waitFor();
        await verifyModal(await modal.locator("h2").innerText());
      }
    }
    await page.getByRole("tab", { name: "Мастера", exact: true }).click();
    const payout = page.getByRole("button", { name: "Провести выплату", exact: true }).first();
    if (await payout.count()) {
      await payout.click();
      const modal = page.locator(".modal-panel");
      await modal.waitFor();
      await verifyModal(await modal.locator("h2").innerText());
    }
    await page.goto(baseUrl + "/inbox", { waitUntil: "networkidle" });
    const queue = page.getByRole("region", { name: "Список входящих заявок" });
    if (await queue.count()) {
      await queue.getByRole("button").first().click();
      assert.ok(await page.locator("#incoming-lead-details").isVisible());
      await capture("inbox-detail-" + width);
      const reject = page.getByRole("button", { name: "Отклонить", exact: true });
      if (await reject.count()) {
        await reject.click();
        await verifyModal("Отклонить заявку");
      }
      if (width < 1024) {
        await page
          .getByRole("button", { name: "Все обращения", exact: true })
          .click();
        assert.ok(await queue.isVisible());
      }
    }
  }
  assert.deepEqual(errors, [], "Browser errors");
  console.log(
    "Figma structure: " +
      captures +
      " responsive/theme captures; four-step draft, expanded ledger, centered dialogs, focus and mobile inbox passed. No business records were saved.",
  );
} finally {
  await context.close();
  await browser.close();
}
