import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://localhost:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("UI audit credentials are required.");

const routes = [
  "/", "/orders", "/quick-order", "/clients", "/calendar", "/masters", "/documents",
  "/contracts", "/finance", "/tasks", "/notifications", "/chat", "/analytics", "/sites",
  "/settings", "/help",
];
const outputDirectory = resolve("artifacts/audit");
mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark", reducedMotion: "reduce" });
const page = await context.newPage();
const failures = [];
const report = { routes: [], links: [], interactions: [], browserErrors: [] };

page.on("pageerror", (error) => report.browserErrors.push(`pageerror: ${error.stack ?? error.message}`));
page.on("console", (message) => { if (message.type() === "error") report.browserErrors.push(`console: ${message.text()}`); });

async function authenticate() {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/login") return;
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function openRoute(route) {
  const response = await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  const pathname = new URL(page.url()).pathname;
  const bodyText = await page.locator("body").innerText();
  const status = response?.status() ?? 0;
  const routeFailures = [];
  if (status >= 400) routeFailures.push(`HTTP ${status}`);
  if (pathname === "/login") routeFailures.push("unexpected authentication redirect");
  if (/страница не найдена|this page could not be found/i.test(bodyText)) routeFailures.push("not-found content");
  const unnamedButtons = await page.locator("button:visible:not([disabled])").evaluateAll((buttons) => buttons
    .filter((button) => !(button.getAttribute("aria-label") ?? button.textContent ?? "").trim())
    .map((button) => button.outerHTML.slice(0, 180)));
  if (unnamedButtons.length) routeFailures.push(`${unnamedButtons.length} enabled button(s) without an accessible name`);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (horizontalOverflow > 1) routeFailures.push(`horizontal overflow ${horizontalOverflow}px`);
  report.routes.push({ route, status, pathname, enabledButtons: await page.locator("button:visible:not([disabled])").count(), unnamedButtons, horizontalOverflow, failures: routeFailures });
  failures.push(...routeFailures.map((failure) => `${route}: ${failure}`));
}

async function expectDialog(route, buttonName, dialogName) {
  await openRoute(route);
  const button = page.getByRole("button", { name: buttonName, exact: true }).first();
  await button.waitFor();
  await button.click();
  await page.getByRole("dialog", { name: dialogName, exact: true }).waitFor();
  report.interactions.push({ route, action: `button:${buttonName}`, result: `dialog:${dialogName}` });
  await page.keyboard.press("Escape");
}

try {
  await authenticate();

  for (const route of routes) await openRoute(route);

  await openRoute("/");
  const calendarSection = page.getByRole("heading", { name: "Календарь выездов", exact: true }).locator("xpath=ancestor::section");
  const selectedDateBefore = await calendarSection.locator("p").first().innerText();
  await calendarSection.getByRole("button", { name: "Следующий день", exact: true }).click();
  const selectedDateAfter = await calendarSection.locator("p").first().innerText();
  if (selectedDateBefore === selectedDateAfter) failures.push("/: mini-calendar did not change date");
  const eventLink = calendarSection.locator('a[href^="/orders/"], a[href^="/calendar?"]').first();
  if (await eventLink.count()) {
    const eventHref = await eventLink.getAttribute("href");
    const eventResponse = await context.request.get(new URL(eventHref, baseUrl).toString());
    report.interactions.push({ route: "/", action: "mini-calendar event", result: `${eventResponse.status()} ${eventHref}` });
    if (eventResponse.status() >= 400) failures.push(`/: mini-calendar destination ${eventHref} returned ${eventResponse.status()}`);
  }

  await openRoute("/chat");
  const chatGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('[data-testid="chat-workspace"]');
    const messages = document.querySelector('[data-testid="chat-message-list"]');
    const composer = workspace?.querySelector("form");
    if (!(workspace instanceof HTMLElement) || !(messages instanceof HTMLElement)) return null;
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyHeight: document.body.getBoundingClientRect().height,
      bodyMargin: getComputedStyle(document.body).margin,
      mainBox: (() => { const main = document.querySelector("main"); return main ? { top: main.getBoundingClientRect().top, bottom: main.getBoundingClientRect().bottom, height: main.getBoundingClientRect().height } : null; })(),
      headerBox: (() => { const header = document.querySelector("body > div header"); return header ? { top: header.getBoundingClientRect().top, bottom: header.getBoundingClientRect().bottom, height: header.getBoundingClientRect().height } : null; })(),
      workspaceBottom: workspace.getBoundingClientRect().bottom,
      messageClientHeight: messages.clientHeight,
      messageScrollHeight: messages.scrollHeight,
      messageOverflowY: getComputedStyle(messages).overflowY,
      composerBottom: composer instanceof HTMLElement ? composer.getBoundingClientRect().bottom : null,
    };
  });
  report.interactions.push({ route: "/chat", action: "layout geometry", result: chatGeometry });
  if (!chatGeometry) failures.push("/chat: workspace geometry is unavailable");
  else {
    if (chatGeometry.documentHeight > chatGeometry.viewportHeight + 2) failures.push(`/chat: whole page scrolls (${chatGeometry.documentHeight}px > ${chatGeometry.viewportHeight}px)`);
    if (chatGeometry.messageOverflowY !== "auto") failures.push(`/chat: message list overflow is ${chatGeometry.messageOverflowY}`);
    if (chatGeometry.workspaceBottom > chatGeometry.viewportHeight + 2) failures.push("/chat: workspace extends below viewport");
    if (chatGeometry.composerBottom !== null && chatGeometry.composerBottom > chatGeometry.viewportHeight + 2) failures.push("/chat: composer is outside viewport");
  }
  await page.screenshot({ path: resolve(outputDirectory, "chat-desktop.png"), fullPage: false });

  await page.setViewportSize({ width: 320, height: 568 });
  await openRoute("/chat");
  await page.getByTestId("chat-message-list").waitFor();
  await page.getByRole("button", { name: "Вернуться к каналам", exact: true }).click();
  await page.getByPlaceholder("Найти канал").waitFor();
  const channelButtons = page.getByTestId("chat-workspace").locator('aside').first().locator('button:visible').filter({ hasText: /.+/ });
  if (await channelButtons.count()) await channelButtons.first().click();
  await page.getByTestId("chat-message-list").waitFor();
  const mobileChatGeometry = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    messageVisible: Boolean(document.querySelector('[data-testid="chat-message-list"]')?.getBoundingClientRect().height),
    composerVisible: Boolean(document.querySelector('[data-testid="chat-workspace"] form')?.getBoundingClientRect().height),
  }));
  report.interactions.push({ route: "/chat", action: "mobile channel navigation", result: mobileChatGeometry });
  if (mobileChatGeometry.documentHeight > mobileChatGeometry.viewportHeight + 2) failures.push(`/chat mobile: whole page scrolls (${mobileChatGeometry.documentHeight}px > ${mobileChatGeometry.viewportHeight}px)`);
  if (!mobileChatGeometry.messageVisible || !mobileChatGeometry.composerVisible) failures.push("/chat mobile: conversation or composer is not visible after channel selection");
  await page.screenshot({ path: resolve(outputDirectory, "chat-mobile.png"), fullPage: false });
  await page.setViewportSize({ width: 1920, height: 1080 });

  await expectDialog("/sites", "Подключить сайт", "Новый сайт");
  await expectDialog("/orders", "Новый заказ", "Новый заказ");
  await expectDialog("/clients", "Новый клиент", "Новый клиент");
  await expectDialog("/masters", "Новый мастер", "Новый мастер");
  await expectDialog("/documents", "Добавить документ", "Новый документ");
  await expectDialog("/contracts", "Новый договор", "Новый договор");
  await expectDialog("/tasks", "Новая задача", "Новая задача");
  await expectDialog("/chat", "Новая группа", "Новая группа");

  await openRoute("/");
  if (await page.getByRole("link", { name: "Новый заказ", exact: true }).count()) failures.push("/: redundant new-order action is still visible in the global header");
  report.interactions.push({ route: "/", action: "global new-order action", result: "not rendered" });

  await openRoute("/orders");
  await page.getByRole("button", { name: /^Новый\s+\d+$/ }).click();
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры заказов", exact: true }).getByRole("radio", { name: "Без мастера", exact: true }).click();
  await page.getByRole("button", { name: "Показать заказы", exact: true }).click();
  await page.getByText(/2 активных условий/).waitFor();
  report.interactions.push({ route: "/orders", action: "status and assignment filters", result: "2 active conditions" });

  await openRoute("/clients");
  await page.getByRole("button", { name: /^С заказами\s+\d+$/ }).click();
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры клиентов", exact: true }).getByRole("radio", { name: "Юридические лица", exact: true }).click();
  await page.getByRole("button", { name: "Показать клиентов", exact: true }).click();
  await page.getByText(/2 активных условий/).waitFor();
  report.interactions.push({ route: "/clients", action: "history and entity type filters", result: "2 active conditions" });

  await openRoute("/contracts");
  await page.getByRole("button", { name: /Действуют/ }).click();
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры договоров", exact: true }).getByRole("radio", { name: "Есть график", exact: true }).click();
  await page.getByRole("button", { name: "Показать договоры", exact: true }).click();
  await page.getByText(/2 активных условий/).waitFor();
  report.interactions.push({ route: "/contracts", action: "status and schedule filters", result: "2 active conditions" });

  await openRoute("/documents");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры документов", exact: true }).getByRole("radio", { name: "Акты", exact: true }).click();
  await page.getByRole("button", { name: "Показать документы", exact: true }).click();
  await page.getByText(/1 активных условий/).waitFor();
  report.interactions.push({ route: "/documents", action: "category filter", result: "1 active condition" });

  await openRoute("/finance");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры дебиторки", exact: true }).getByRole("radio", { name: "Не всё выставлено", exact: true }).click();
  await page.getByRole("button", { name: "Показать заказы", exact: true }).click();
  await page.getByText(/1 активных условий/).waitFor();
  report.interactions.push({ route: "/finance", action: "receivables state filter", result: "1 active condition" });
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  const invoiceButton = page.getByRole("button", { name: "Новый счёт", exact: true }).first();
  await invoiceButton.waitFor();
  await invoiceButton.click();
  await page.getByRole("dialog", { name: "Новый счёт", exact: true }).waitFor();
  report.interactions.push({ route: "/finance", action: "button:Новый счёт", result: "dialog:Новый счёт" });
  await page.keyboard.press("Escape");

  await openRoute("/settings");
  await page.getByRole("tab", { name: "Пользователи", exact: true }).click();
  await page.getByRole("button", { name: "Новый сотрудник", exact: true }).click();
  await page.getByRole("dialog", { name: "Новый сотрудник", exact: true }).waitFor();
  report.interactions.push({ route: "/settings", action: "button:Новый сотрудник", result: "dialog:Новый сотрудник" });
  await page.keyboard.press("Escape");

  await openRoute("/clients");
  const clientRow = page.getByRole("link", { name: /Открыть клиента/ }).first();
  await clientRow.waitFor();
  await clientRow.click();
  await page.waitForURL((url) => url.pathname.startsWith("/clients/"));
  report.interactions.push({ route: "/clients", action: "whole client row", result: new URL(page.url()).pathname });

  await openRoute("/masters");
  const masterCard = page.getByRole("link", { name: /Открыть карточку мастера/ }).first();
  await masterCard.waitFor();
  await masterCard.click();
  await page.waitForURL((url) => url.pathname.startsWith("/masters/"));
  await page.getByRole("heading", { name: "Последние выезды", exact: true }).waitFor();
  report.interactions.push({ route: "/masters", action: "whole master card", result: new URL(page.url()).pathname });

  await openRoute("/calendar?view=day");
  const previousDay = page.getByRole("link", { name: "Предыдущий день", exact: true });
  const previousDayHref = await previousDay.getAttribute("href");
  if (!previousDayHref?.includes("view=day")) failures.push("/calendar day: navigation does not preserve day view");
  await previousDay.click();
  await page.waitForLoadState("networkidle");
  if (!new URL(page.url()).searchParams.get("view")?.includes("day")) failures.push("/calendar day: previous navigation returned another view");
  report.interactions.push({ route: "/calendar?view=day", action: "previous day", result: page.url() });

  await openRoute("/calendar?view=month");
  const previousMonth = page.getByRole("link", { name: "Предыдущий месяц", exact: true });
  const previousMonthHref = await previousMonth.getAttribute("href");
  if (!previousMonthHref?.includes("view=month")) failures.push("/calendar month: navigation does not preserve month view");
  const draggableOrder = page.locator('aside article[draggable="true"]').first();
  if (!(await draggableOrder.count())) failures.push("/calendar: unassigned orders are not exposed as draggable cards");
  report.interactions.push({ route: "/calendar?view=month", action: "unassigned order drag affordance", result: await draggableOrder.count() ? "draggable" : "missing" });

  const newVisitLink = page.locator('aside a[href*="newVisit=1"]').first();
  if (await newVisitLink.count()) {
    await newVisitLink.click();
    await page.waitForURL((url) => url.pathname.startsWith("/orders/") && url.searchParams.get("newVisit") === "1");
    await page.getByRole("dialog", { name: "Новый выезд", exact: true }).waitFor();
    report.interactions.push({ route: "/calendar", action: "unassigned order fallback", result: "dialog:Новый выезд" });
    await page.keyboard.press("Escape");
  }

  const discoveredLinks = new Set();
  for (const route of routes) {
    await openRoute(route);
    const hrefs = await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    for (const href of hrefs) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
      const url = new URL(href, baseUrl);
      if (url.origin !== new URL(baseUrl).origin || url.pathname.startsWith("/api/")) continue;
      discoveredLinks.add(`${url.pathname}${url.search}`);
    }
  }
  for (const href of [...discoveredLinks].sort()) {
    const linkPage = await context.newPage();
    const response = await linkPage.goto(`${baseUrl}${href}`, { waitUntil: "domcontentloaded" });
    const status = response?.status() ?? 0;
    const finalPath = new URL(linkPage.url()).pathname;
    const notFound = /страница не найдена|this page could not be found/i.test(await linkPage.locator("body").innerText());
    report.links.push({ href, status, finalPath, notFound });
    if (status >= 400 || notFound) failures.push(`link ${href}: ${status || "no response"}${notFound ? " with not-found content" : ""}`);
    await linkPage.close();
  }

  await writeFile(resolve(outputDirectory, "ui-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (report.browserErrors.length) failures.push(...report.browserErrors);
  if (failures.length) throw new Error(`UI audit failed:\n${[...new Set(failures)].join("\n")}`);
  console.log(JSON.stringify({ operation: "ui.audit", status: "succeeded", routes: report.routes.length, links: report.links.length, interactions: report.interactions.length, outputDirectory }));
} finally {
  await browser.close();
}
