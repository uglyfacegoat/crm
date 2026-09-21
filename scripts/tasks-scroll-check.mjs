import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://127.0.0.1:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!identity || !password) throw new Error("Task scroll check requires login credentials.");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mkdir("artifacts/tasks-scroll", { recursive: true });
  await page.goto(`${baseUrl}/tasks`);
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/tasks");
  }
  await page.locator(".tasks-group").first().waitFor();

  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator(".tasks-queue").evaluate((element) => getComputedStyle(element).overflowY), "visible");
    const lists = page.locator(".tasks-group-list");
    let checked = 0;
    for (let index = 0; index < await lists.count(); index += 1) {
      const list = lists.nth(index);
      const overflow = await list.evaluate((element) => element.scrollHeight > element.clientHeight);
      if (!overflow) continue;
      await list.scrollIntoViewIfNeeded();
      await list.evaluate((element) => { element.scrollTop = 0; });
      const before = await list.evaluate((element) => ({
        headerTop: element.previousElementSibling.getBoundingClientRect().top,
        pageHeight: document.documentElement.scrollHeight,
        pageTop: window.scrollY,
        others: Array.from(document.querySelectorAll(".tasks-group-list")).filter((other) => other !== element).map((other) => other.scrollTop),
      }));
      const bounds = await list.boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(bounds.height / 2, 100));
      await page.mouse.wheel(0, 320);
      await page.waitForFunction((id) => document.getElementById(id).scrollTop > 0, await list.getAttribute("id"));
      const after = await list.evaluate((element) => ({
        headerTop: element.previousElementSibling.getBoundingClientRect().top,
        pageHeight: document.documentElement.scrollHeight,
        pageTop: window.scrollY,
        others: Array.from(document.querySelectorAll(".tasks-group-list")).filter((other) => other !== element).map((other) => other.scrollTop),
      }));
      assert.deepEqual(after, before, "Scrolling a group must not move its header, page, or other groups");
      await list.focus();
      await page.keyboard.press("End");
      await page.waitForFunction((id) => {
        const element = document.getElementById(id);
        return Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop) <= 1;
      }, await list.getAttribute("id"));
      checked += 1;
    }
    assert.ok(checked > 0, "Use a test company with at least one overflowing task group");
    assert.equal(await page.locator(".tasks-row-open svg").count(), 0);
    assert.equal(await page.locator(".tasks-column-tabs").count(), 0);
    await page.locator(".tasks-group-list").evaluateAll((elements) => {
      for (const element of elements) element.scrollTop = 0;
    });
    await page.locator("#tasks-upcoming").screenshot({ path: `artifacts/tasks-scroll/upcoming-${viewport.width}.png` });
    console.log(`${viewport.width}px: ${checked} independent group scrollers verified with wheel and keyboard`);

    await page.getByRole("tab", { name: /Последние выполненные/ }).click();
    const completedList = page.locator("#tasks-completed-list");
    if (await completedList.count()) {
      assert.equal(await completedList.evaluate((element) => getComputedStyle(element).overflowY), "auto");
      assert.equal(await page.locator(".tasks-queue").evaluate((element) => getComputedStyle(element).overflowY), "visible");
    }
    await page.getByRole("tab", { name: /Все задачи/ }).click();
  }
  assert.deepEqual(pageErrors, [], "Task page must not produce uncaught browser errors");
} finally {
  await browser.close();
}
