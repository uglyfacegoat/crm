import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://localhost:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("UI audit credentials are required.");

const routes = [
  "/", "/orders", "/inbox", "/quick-order", "/clients", "/calendar", "/masters", "/documents", "/documents/archive",
  "/contracts", "/finance", "/tasks", "/notifications", "/chat", "/analytics", "/sites",
  "/companies", "/settings", "/help",
];
const outputDirectory = resolve("artifacts/audit");
mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: "light", reducedMotion: "reduce" });
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

async function auditLaptopLayout(width, height) {
  const viewport = `${width}x${height}`;
  await page.setViewportSize({ width, height });
  await openRoute("/");

  const sidebarNavigation = page.getByRole("navigation", { name: "Основная навигация", exact: true });
  const sidebar = sidebarNavigation.locator("xpath=ancestor::aside");
  const sidebarGeometry = await sidebar.evaluate((element) => {
    const navigation = element.querySelector('nav[aria-label="Основная навигация"]');
    const settings = [...element.querySelectorAll("a")].find((link) => link.textContent?.trim() === "Настройки");
    const logout = [...element.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Выйти");
    if (!(navigation instanceof HTMLElement) || !(settings instanceof HTMLElement) || !(logout instanceof HTMLElement)) return null;
    const asideBox = element.getBoundingClientRect();
    const settingsBox = settings.getBoundingClientRect();
    const logoutBox = logout.getBoundingClientRect();
    const style = getComputedStyle(navigation);
    return {
      viewportHeight: window.innerHeight,
      asideTop: asideBox.top,
      asideBottom: asideBox.bottom,
      settingsBottom: settingsBox.bottom,
      logoutBottom: logoutBox.bottom,
      navigationClientHeight: navigation.clientHeight,
      navigationScrollHeight: navigation.scrollHeight,
      navigationOverflowY: style.overflowY,
    };
  });
  if (!sidebarGeometry) failures.push(`${viewport} sidebar: geometry is unavailable`);
  else {
    if (sidebarGeometry.asideTop < -1 || sidebarGeometry.asideBottom > height + 1) failures.push(`${viewport} sidebar: shell is outside the viewport`);
    if (sidebarGeometry.settingsBottom > height + 1 || sidebarGeometry.logoutBottom > height + 1) failures.push(`${viewport} sidebar: settings or logout is clipped`);
    if (sidebarGeometry.navigationOverflowY !== "auto") failures.push(`${viewport} sidebar: navigation overflow is ${sidebarGeometry.navigationOverflowY}`);
    if (sidebarGeometry.navigationScrollHeight > sidebarGeometry.navigationClientHeight + 1) {
      await sidebarNavigation.evaluate((element) => { element.scrollTop = Math.min(120, element.scrollHeight - element.clientHeight); });
      if ((await sidebarNavigation.evaluate((element) => element.scrollTop)) <= 0) failures.push(`${viewport} sidebar: navigation cannot be scrolled`);
    }
  }
  report.interactions.push({ route: "/", action: `sidebar layout ${viewport}`, result: sidebarGeometry });

  const recentOrders = page.getByRole("heading", { name: "Новые и обновлённые", exact: true }).locator("xpath=ancestor::section");
  const recentOrdersScroller = recentOrders.locator("table").locator("xpath=parent::div");
  const recentOrdersGeometry = await recentOrdersScroller.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
  }));
  if (recentOrdersGeometry.scrollWidth > recentOrdersGeometry.clientWidth + 1) failures.push(`${viewport} dashboard: recent orders is clipped by ${recentOrdersGeometry.scrollWidth - recentOrdersGeometry.clientWidth}px`);
  if (recentOrdersGeometry.left < -1 || recentOrdersGeometry.right > width + 1) failures.push(`${viewport} dashboard: recent orders is outside the viewport`);
  report.interactions.push({ route: "/", action: `recent orders layout ${viewport}`, result: recentOrdersGeometry });

  await openRoute("/calendar?view=week");
  const schedule = page.getByRole("region", { name: "Прокручиваемая сетка расписания", exact: true });
  await schedule.waitFor();
  const scheduleGeometry = await schedule.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      left: box.left,
      right: box.right,
      top: box.top,
      bottom: box.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  if (scheduleGeometry.overflowX !== "auto" || scheduleGeometry.overflowY !== "auto") failures.push(`${viewport} calendar: schedule is not an explicit scroll region`);
  if (scheduleGeometry.left < -1 || scheduleGeometry.right > width + 1 || scheduleGeometry.top < -1 || scheduleGeometry.bottom > height + 4) failures.push(`${viewport} calendar: schedule is outside the viewport`);
  if (scheduleGeometry.scrollHeight <= scheduleGeometry.clientHeight + 1) failures.push(`${viewport} calendar: vertical schedule overflow was not reproduced`);
  const stickyHeader = schedule.locator(".sticky").first();
  const headerTopBefore = (await stickyHeader.boundingBox())?.y ?? null;
  await schedule.evaluate((element) => { element.scrollTop = Math.min(300, element.scrollHeight - element.clientHeight); });
  await page.waitForTimeout(50);
  const scrolledTop = await schedule.evaluate((element) => element.scrollTop);
  const headerTopAfter = (await stickyHeader.boundingBox())?.y ?? null;
  if (scrolledTop <= 0) failures.push(`${viewport} calendar: schedule cannot be scrolled vertically`);
  if (headerTopBefore === null || headerTopAfter === null || Math.abs(headerTopBefore - headerTopAfter) > 2) failures.push(`${viewport} calendar: day header is not sticky`);
  report.interactions.push({ route: "/calendar?view=week", action: `schedule layout ${viewport}`, result: { ...scheduleGeometry, scrolledTop, headerTopBefore, headerTopAfter } });
}

async function auditDetailRoutes() {
  const detailChecks = [
    { list: "/orders", prefix: "/orders/", backLabel: "К заказам", backHref: "/orders" },
    { list: "/clients", prefix: "/clients/", backLabel: "К списку клиентов", backHref: "/clients" },
    { list: "/masters", prefix: "/masters/", backLabel: "К списку мастеров", backHref: "/masters" },
    { list: "/contracts", prefix: "/contracts/", backLabel: "К договорам", backHref: "/contracts" },
    { list: "/sites", prefix: "/sites/", backLabel: "К сайтам", backHref: "/sites" },
  ];

  for (const detailCheck of detailChecks) {
    await openRoute(detailCheck.list);
    const href = await page.locator(`a[href^="${detailCheck.prefix}"]`).first().getAttribute("href");
    if (!href) {
      failures.push(`${detailCheck.list}: no detail link found for UI audit`);
      continue;
    }
    await openRoute(href);
    const backLink = page.getByRole("link", { name: detailCheck.backLabel, exact: true });
    if (!(await backLink.count())) failures.push(`${href}: consistent back link '${detailCheck.backLabel}' is missing`);
    else if ((await backLink.first().getAttribute("href")) !== detailCheck.backHref) failures.push(`${href}: back link does not return to ${detailCheck.backHref}`);
    report.interactions.push({ route: href, action: "detail navigation", result: detailCheck.backLabel });
  }

  await openRoute("/settings");
  await page.getByRole("tab", { name: "Пользователи", exact: true }).click();
  const memberHref = await page.locator('a[href^="/settings/users/"]').first().getAttribute("href");
  if (!memberHref) failures.push("/settings: no member detail link found for UI audit");
  else {
    await openRoute(memberHref);
    const backLink = page.getByRole("link", { name: "К списку пользователей", exact: true });
    if (!(await backLink.count())) failures.push(`${memberHref}: consistent member back link is missing`);
    else if ((await backLink.first().getAttribute("href")) !== "/settings") failures.push(`${memberHref}: member back link does not return to /settings`);
    report.interactions.push({ route: memberHref, action: "detail navigation", result: "К списку пользователей" });
  }
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
  await auditLaptopLayout(1366, 768);
  await auditLaptopLayout(1440, 900);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await auditDetailRoutes();

  await openRoute("/");
  const calendarSection = page.getByRole("heading", { name: "Календарь выездов", exact: true }).locator("xpath=ancestor::section");
  const selectedDateBefore = await calendarSection.locator("time[datetime]").innerText();
  await calendarSection.getByRole("button", { name: "Следующий день", exact: true }).click();
  const selectedDateAfter = await calendarSection.locator("time[datetime]").innerText();
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

  await openRoute("/tasks");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры задач", exact: true }).getByRole("radio", { name: "По выездам", exact: true }).click();
  await page.getByRole("button", { name: "Показать задачи", exact: true }).click();
  await page.getByRole("button", { name: /Фильтры\s*1/ }).waitFor();
  report.interactions.push({ route: "/tasks", action: "task source filter", result: "1 active condition" });

  await openRoute("/sites");
  await page.getByRole("button", { name: "Фильтры", exact: true }).click();
  await page.getByRole("dialog", { name: "Фильтры сайтов", exact: true }).getByRole("radio", { name: "Без интеграций", exact: true }).click();
  await page.getByRole("button", { name: "Показать сайты", exact: true }).click();
  await page.getByRole("button", { name: /Фильтры\s*1/ }).waitFor();
  report.interactions.push({ route: "/sites", action: "integration state filter", result: "1 active condition" });

  await openRoute("/settings");
  await page.getByRole("tab", { name: "Пользователи", exact: true }).click();
  await page.getByRole("button", { name: "Новый сотрудник", exact: true }).click();
  await page.getByRole("dialog", { name: "Новый сотрудник", exact: true }).waitFor();
  report.interactions.push({ route: "/settings", action: "button:Новый сотрудник", result: "dialog:Новый сотрудник" });
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Представление", exact: true }).click();
  await page.locator("label").filter({ hasText: "Крупный" }).click();
  await page.locator("label").filter({ hasText: "Табличные цифры" }).click();
  await page.getByRole("button", { name: "Сохранить представление", exact: true }).click();
  await page.getByText("Представление сохранено для этого браузера.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.fontScale === "large" && document.documentElement.dataset.digitStyle === "tabular");
  report.interactions.push({ route: "/settings", action: "save appearance", result: "large + tabular" });
  await page.getByRole("tab", { name: "Представление", exact: true }).click();
  await page.locator("label").filter({ hasText: "Стандартный" }).click();
  await page.locator("label").filter({ hasText: "Обычные цифры" }).click();
  await page.getByRole("button", { name: "Сохранить представление", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.fontScale === "standard" && document.documentElement.dataset.digitStyle === "proportional");

  await openRoute("/clients");
  await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
  const clientDialog = page.getByRole("dialog", { name: "Новый клиент", exact: true });
  const phoneInput = clientDialog.locator('input[name="phone"]');
  const emailInput = clientDialog.locator('input[name="email"]');
  await phoneInput.fill("89991234567");
  await emailInput.fill("1111");
  const clientValidation = await clientDialog.evaluate((dialog) => ({
    phone: dialog.querySelector('input[name="phone"]')?.value,
    emailValid: dialog.querySelector('input[name="email"]')?.checkValidity(),
  }));
  if (clientValidation.phone !== "+7 (999) 123-45-67") failures.push(`/clients: phone mask returned ${clientValidation.phone}`);
  if (clientValidation.emailValid !== false) failures.push("/clients: malformed email passed browser validation");
  report.interactions.push({ route: "/clients", action: "contact input validation", result: clientValidation });
  await page.keyboard.press("Escape");
  const clientRow = page.getByRole("link", { name: /Открыть клиента/ }).first();
  await clientRow.waitFor();
  await clientRow.click();
  await page.waitForURL((url) => url.pathname.startsWith("/clients/"));
  report.interactions.push({ route: "/clients", action: "client detail link", result: new URL(page.url()).pathname });

  await openRoute("/masters");
  const masterCard = page.getByRole("link", { name: /Открыть карточку мастера/ }).first();
  await masterCard.waitFor();
  await masterCard.click();
  await page.waitForURL((url) => url.pathname.startsWith("/masters/"));
  await page.getByRole("heading", { name: "Последние выезды", exact: true }).waitFor();
  report.interactions.push({ route: "/masters", action: "master detail link", result: new URL(page.url()).pathname });

  await openRoute("/calendar?view=week");
  await page.getByRole("button", { name: "Месяц", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/calendar" && url.searchParams.get("view") === "month");
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.getByRole("button", { name: "Месяц", exact: true }).getAttribute("aria-pressed")) !== "true") failures.push("/calendar: selected view is not restored from the URL");
  report.interactions.push({ route: "/calendar?view=week", action: "switch view and reload", result: page.url() });

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
  const draggableOrderCount = await draggableOrder.count();
  const emptyUnassignedState = await page.getByText("Все активные заказы уже в расписании", { exact: true }).count();
  if (!draggableOrderCount && !emptyUnassignedState) failures.push("/calendar: unassigned orders expose neither draggable cards nor an empty state");
  report.interactions.push({ route: "/calendar?view=month", action: "unassigned order drag affordance", result: draggableOrderCount ? "draggable" : "empty state" });

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
