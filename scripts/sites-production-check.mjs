import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.SMOKE_BASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!baseUrl || !identity || !password) throw new Error("SMOKE_BASE_URL and disposable test-account credentials are required.");

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/sites`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL(`${baseUrl}/sites`);
  await page.getByText("Сайты ещё не добавлены.", { exact: true }).waitFor();
  assert.equal(await page.locator(".sites-register-row").count(), 0);

  const suffix = randomUUID().slice(0, 8);
  const createdNames = [];
  for (const label of ["Alpha", "Bravo", "Charlie", "Delta"]) {
    const name = `Production check ${suffix} ${label}`;
    createdNames.push(name);
    await page.getByRole("button", { name: "Подключить сайт", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Новый сайт" });
    await dialog.locator('input[name="name"]').fill(name);
    await dialog.locator('input[name="domain"]').fill(`check-${suffix}-${label.toLowerCase()}.example.com`);
    await dialog.getByRole("button", { name: "Добавить сайт", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("link", { name, exact: true }).waitFor();
  }

  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".sites-register-row").count(), 4, "All four persisted sites must remain visible with no traffic");
  for (const name of createdNames) {
    const row = page.locator(".sites-register-row").filter({ hasText: name });
    assert.equal(await row.getByText("Нет данных", { exact: true }).count(), 1, "Missing history must not render an invented sparkline");
    assert.equal(await row.locator("svg[aria-label='Динамика трафика']").count(), 0);
  }
  const search = page.getByRole("textbox", { name: "Поиск по сайтам" });
  await search.fill(createdNames[3]);
  await page.getByRole("link", { name: createdNames[0], exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator(".sites-register-row").count(), 1);
  await search.fill("");
  await page.getByRole("button", { name: "Активные", exact: true }).click();
  await page.getByText("Нет сайтов по выбранным фильтрам.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Все сайты · 4", exact: true }).click();
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры сайтов" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Фильтры сайтов" }).waitFor({ state: "hidden" });

  await mkdir("artifacts/production", { recursive: true });
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, `Sites page must fit ${width}px`);
    assert.equal(await page.locator(".sites-register-row").count(), 4);
    await page.screenshot({ path: `artifacts/production/sites-${width}.png`, fullPage: true });
  }
  await page.getByRole("link", { name: createdNames[0], exact: true }).click();
  await page.getByRole("heading", { name: createdNames[0], exact: true }).waitFor();
  assert.equal(await page.getByText("Настройка", { exact: true }).count(), 1);
  assert.equal(await page.getByText("Подключено", { exact: true }).count(), 0, "Registering a site must not claim the integration is connected");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseUrl}/analytics?data=example`, { waitUntil: "networkidle" });
    await page.getByText("За выбранный период нет согласованных услуг.", { exact: true }).waitFor();
    const values = await page.locator(".analytics-open-metric > strong").allTextContents();
    assert.ok(values.length > 0 && values.every((value) => /^0(?:\s*₽)?$/.test(value.trim())), "Empty company analytics must show actual zeros");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `artifacts/production/analytics-empty-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, [], "Production browser flows must not emit runtime errors");
  console.log("Sites production flow passed: empty state, four UI-created sites, persistence, honest traffic state, search/filter, detail and responsive analytics.");
} finally {
  await browser.close();
}
