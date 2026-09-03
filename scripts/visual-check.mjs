import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const defaultBrowserPaths = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge"],
};

const visualCases = [
  { name: "dashboard-4k", path: "/", width: 3840, height: 2160 },
  { name: "dashboard-desktop", path: "/", width: 1920, height: 1080 },
  { name: "dashboard-laptop", path: "/", width: 1366, height: 768 },
  { name: "dashboard-tablet", path: "/", width: 768, height: 1024 },
  { name: "dashboard-mobile", path: "/", width: 390, height: 844 },
  { name: "dashboard-compact", path: "/", width: 320, height: 568 },
  { name: "dashboard-micro", path: "/", width: 280, height: 653 },
  { name: "orders-4k", path: "/orders", width: 3840, height: 2160 },
  { name: "orders-desktop", path: "/orders", width: 1920, height: 1080 },
  { name: "orders-tablet", path: "/orders", width: 1024, height: 768 },
  { name: "orders-compact", path: "/orders", width: 320, height: 568 },
  { name: "orders-filters-desktop", path: "/orders", width: 1920, height: 1080, openFiltersDialog: "Фильтры заказов" },
  { name: "orders-filters-mobile", path: "/orders", width: 320, height: 568, openFiltersDialog: "Фильтры заказов" },
  { name: "order-create-dialog-desktop", path: "/orders", width: 1920, height: 1080, openOrderDialog: true },
  { name: "order-create-dialog-mobile", path: "/orders", width: 320, height: 568, openOrderDialog: true },
  { name: "clients-mobile", path: "/clients", width: 360, height: 800 },
  { name: "clients-desktop", path: "/clients", width: 1920, height: 1080 },
  { name: "clients-filters-desktop", path: "/clients", width: 1920, height: 1080, openFiltersDialog: "Фильтры клиентов" },
  { name: "clients-filters-mobile", path: "/clients", width: 320, height: 568, openFiltersDialog: "Фильтры клиентов" },
  { name: "clients-dialog-desktop", path: "/clients", width: 1920, height: 1080, openClientDialog: true },
  { name: "clients-dialog-mobile", path: "/clients", width: 320, height: 568, openClientDialog: true },
  { name: "client-detail-desktop", path: "/clients/cl-1", width: 1920, height: 1080 },
  { name: "client-detail-4k", path: "/clients/cl-1", width: 3840, height: 2160 },
  { name: "client-detail-mobile", path: "/clients/cl-1", width: 320, height: 568 },
  { name: "client-object-dialog-mobile", path: "/clients/cl-1", width: 360, height: 800, openObjectDialog: true },
  { name: "calendar-mobile", path: "/calendar", width: 390, height: 844 },
  { name: "calendar-desktop", path: "/calendar", width: 1920, height: 1080 },
  { name: "calendar-list-desktop", path: "/calendar", width: 1920, height: 1080, openCalendarList: true },
  { name: "calendar-list-mobile", path: "/calendar", width: 320, height: 568, openCalendarList: true },
  { name: "documents-mobile", path: "/documents", width: 360, height: 800 },
  { name: "documents-desktop", path: "/documents", width: 1920, height: 1080 },
  { name: "documents-filters-desktop", path: "/documents", width: 1920, height: 1080, openFiltersDialog: "Фильтры документов" },
  { name: "documents-filters-mobile", path: "/documents", width: 320, height: 568, openFiltersDialog: "Фильтры документов" },
  { name: "masters-4k", path: "/masters", width: 3840, height: 2160 },
  { name: "masters-desktop", path: "/masters", width: 1920, height: 1080 },
  { name: "master-detail-4k", path: "/masters/master-1", width: 3840, height: 2160 },
  { name: "master-detail-desktop", path: "/masters/master-1", width: 1920, height: 1080 },
  { name: "master-detail-mobile", path: "/masters/master-1", width: 320, height: 568 },
  { name: "tasks-tablet", path: "/tasks", width: 768, height: 1024 },
  { name: "tasks-desktop", path: "/tasks", width: 1920, height: 1080 },
  { name: "contracts-4k", path: "/contracts", width: 3840, height: 2160 },
  { name: "contracts-mobile", path: "/contracts", width: 320, height: 568 },
  { name: "contracts-filters-desktop", path: "/contracts", width: 1920, height: 1080, openFiltersDialog: "Фильтры договоров" },
  { name: "contracts-filters-mobile", path: "/contracts", width: 320, height: 568, openFiltersDialog: "Фильтры договоров" },
  { name: "finance-4k", path: "/finance", width: 3840, height: 2160 },
  { name: "finance-mobile", path: "/finance", width: 320, height: 568 },
  { name: "notifications-desktop", path: "/notifications", width: 1920, height: 1080 },
  { name: "notifications-mobile", path: "/notifications", width: 320, height: 568 },
  { name: "notifications-4k", path: "/notifications", width: 3840, height: 2160 },
  { name: "chat-desktop", path: "/chat", width: 1920, height: 1080 },
  { name: "chat-mobile", path: "/chat", width: 320, height: 568 },
  { name: "chat-mobile-channels", path: "/chat", width: 320, height: 568, openChatChannels: true },
  { name: "chat-4k", path: "/chat", width: 3840, height: 2160 },
  { name: "order-4k", path: "/orders/ord-1248", width: 3840, height: 2160 },
  { name: "order-compact", path: "/orders/ord-1248", width: 320, height: 568 },
  { name: "order-relations-dialog-desktop", path: "/orders/ord-1248", width: 1920, height: 1080, openOrderRelationsDialog: true },
  { name: "order-relations-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openOrderRelationsDialog: true },
  { name: "order-edit-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openOrderEditDialog: true },
  { name: "visit-create-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitDialog: true },
  { name: "visit-series-dialog-desktop", path: "/orders/ord-1248", width: 1920, height: 1080, openVisitSeriesDialog: true },
  { name: "visit-series-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitSeriesDialog: true },
  { name: "visit-edit-dialog-mobile", path: "/orders/ord-1248", width: 320, height: 568, openVisitEditDialog: true },
  { name: "analytics-4k", path: "/analytics", width: 3840, height: 2160 },
  { name: "analytics-desktop", path: "/analytics", width: 1920, height: 1080 },
  { name: "analytics-mobile", path: "/analytics", width: 320, height: 568 },
  { name: "sites-desktop", path: "/sites", width: 1920, height: 1080 },
  { name: "sites-micro", path: "/sites", width: 280, height: 653 },
  { name: "site-connect-dialog-desktop", path: "/sites", width: 1920, height: 1080, openSiteDialog: true },
  { name: "site-connect-dialog-mobile", path: "/sites", width: 320, height: 568, openSiteDialog: true },
  { name: "settings-desktop", path: "/settings", width: 1920, height: 1080 },
  { name: "settings-mobile", path: "/settings", width: 320, height: 568 },
  { name: "help-desktop", path: "/help", width: 1920, height: 1080 },
  { name: "help-mobile", path: "/help", width: 320, height: 568 },
  { name: "login-4k", path: "/login", width: 3840, height: 2160 },
  { name: "login-desktop", path: "/login", width: 1920, height: 1080 },
  { name: "login-micro", path: "/login", width: 280, height: 653 },
];

const configuredBrowserPath = process.env.CHROME_PATH;
const browserPath = configuredBrowserPath ?? defaultBrowserPaths[process.platform]?.find(existsSync);

if (!browserPath) {
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to a Chromium executable.");
}

const baseUrl = process.env.VISUAL_BASE_URL ?? "http://localhost:3000";
const identity = process.env.VISUAL_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.VISUAL_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const outputDirectory = resolve("artifacts/visual");
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const authenticatedContext = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
const failures = [];

try {
  const authenticationPage = await authenticatedContext.newPage();
  await authenticationPage.goto(baseUrl, { waitUntil: "networkidle" });
  if (new URL(authenticationPage.url()).pathname === "/login") {
    if (!identity || !password) {
      throw new Error("Visual checks require VISUAL_CHECK_IDENTITY and VISUAL_CHECK_PASSWORD when authentication is enabled.");
    }
    await authenticationPage.getByPlaceholder("Email или телефон").fill(identity);
    await authenticationPage.getByPlaceholder("Пароль").fill(password);
    await authenticationPage.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await authenticationPage.waitForURL((url) => url.pathname !== "/login");
  }

  async function discoverDetailPath(listPath, hrefPrefix) {
    await authenticationPage.goto(`${baseUrl}${listPath}`, { waitUntil: "networkidle" });
    const href = await authenticationPage.locator(`a[href^="${hrefPrefix}"]`).first().getAttribute("href");
    if (!href) throw new Error(`No detail route was found on ${listPath} for ${hrefPrefix}.`);
    return href;
  }

  async function discoverInteractiveDetailPath(listPath, accessibleName, pathPrefix) {
    await authenticationPage.goto(`${baseUrl}${listPath}`, { waitUntil: "networkidle" });
    await authenticationPage.getByRole("link", { name: accessibleName }).first().click();
    await authenticationPage.waitForURL((url) => url.pathname.startsWith(pathPrefix));
    return `${new URL(authenticationPage.url()).pathname}${new URL(authenticationPage.url()).search}`;
  }

  async function discoverOrderWithEditableVisit() {
    await authenticationPage.goto(`${baseUrl}/calendar`, { waitUntil: "networkidle" });
    const orderPaths = await authenticationPage.locator('a[href^="/orders/"]').evaluateAll((links) =>
      [...new Set(links.map((link) => link.getAttribute("href")).filter(Boolean))],
    );

    for (const orderPath of orderPaths.slice(0, 30)) {
      await authenticationPage.goto(`${baseUrl}${orderPath}`, { waitUntil: "networkidle" });
      if (await authenticationPage.getByRole("button", { name: /Редактировать выезд/ }).count()) {
        return orderPath;
      }
    }

    throw new Error("No order with an editable visit was found for the visual audit.");
  }

  const clientDetailPath = await discoverInteractiveDetailPath("/clients", /Открыть клиента/, "/clients/");
  const orderDetailPath = await discoverDetailPath("/orders", "/orders/");
  const masterDetailPath = await discoverInteractiveDetailPath("/masters", /Открыть карточку мастера/, "/masters/");
  const editableVisitOrderPath = await discoverOrderWithEditableVisit();
  await authenticationPage.close();

  for (const visualCase of visualCases) {
    const isolatedLoginContext = visualCase.path === "/login"
      ? await browser.newContext({ deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" })
      : null;
    const page = await (isolatedLoginContext ?? authenticatedContext).newPage();
    await page.setViewportSize({ width: visualCase.width, height: visualCase.height });

    page.on("pageerror", (error) => failures.push(`${visualCase.name}: page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`${visualCase.name}: console error: ${message.text()}`);
    });

    const resolvedPath = visualCase.openVisitEditDialog
      ? editableVisitOrderPath
      : visualCase.path === "/clients/cl-1"
      ? clientDetailPath
      : visualCase.path === "/masters/master-1"
        ? masterDetailPath
      : visualCase.path === "/orders/ord-1248"
        ? orderDetailPath
        : visualCase.path;
    await page.goto(`${baseUrl}${resolvedPath}`, { waitUntil: "networkidle" });
    if (visualCase.openClientDialog) {
      await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый клиент" }).waitFor();
    }
    if (visualCase.openFiltersDialog) {
      await page.getByRole("button", { name: "Фильтры", exact: true }).click();
      await page.getByRole("dialog", { name: visualCase.openFiltersDialog }).waitFor();
    }
    if (visualCase.openObjectDialog) {
      await page.getByRole("button", { name: "Новый объект", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый объект" }).waitFor();
    }
    if (visualCase.openOrderDialog) {
      await page.getByRole("button", { name: "Новый заказ", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый заказ" }).waitFor();
    }
    if (visualCase.openOrderEditDialog) {
      await page.getByRole("button", { name: "Редактировать", exact: true }).click();
      await page.getByRole("dialog", { name: "Редактировать заказ" }).waitFor();
    }
    if (visualCase.openVisitDialog) {
      await page.getByRole("button", { name: "Добавить выезд", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый выезд" }).waitFor();
    }
    if (visualCase.openVisitSeriesDialog) {
      await page.getByRole("button", { name: "Создать серию выездов", exact: true }).click();
      await page.getByRole("dialog", { name: "Серия выездов" }).waitFor();
    }
    if (visualCase.openVisitEditDialog) {
      await page.getByRole("button", { name: /Редактировать выезд/ }).first().click();
      await page.getByRole("dialog", { name: "Редактировать выезд" }).waitFor();
    }
    if (visualCase.openOrderRelationsDialog) {
      await page.getByRole("button", { name: "Связать заказ", exact: true }).click();
      await page.getByRole("dialog", { name: "Связать заказы" }).waitFor();
    }
    if (visualCase.openCalendarList) {
      await page.getByRole("button", { name: "Список", exact: true }).click();
      await page.getByRole("heading", { name: "Расписание всех заказов" }).waitFor();
    }
    if (visualCase.openChatChannels) {
      await page.getByRole("button", { name: "Вернуться к каналам", exact: true }).click();
      await page.getByPlaceholder("Найти канал").waitFor();
    }
    if (visualCase.openSiteDialog) {
      await page.getByRole("button", { name: "Подключить сайт", exact: true }).click();
      await page.getByRole("dialog", { name: "Новый сайт", exact: true }).waitFor();
    }

    const viewportState = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }));

    if (viewportState.documentWidth > viewportState.viewportWidth) {
      failures.push(`${visualCase.name}: horizontal overflow ${viewportState.documentWidth}px > ${viewportState.viewportWidth}px`);
    }

    await page.screenshot({ path: resolve(outputDirectory, `${visualCase.name}.png`) });
    await page.close();
    await isolatedLoginContext?.close();
  }
} finally {
  await authenticatedContext.close();
  await browser.close();
}

if (failures.length > 0) {
  throw new Error(`Visual checks failed:\n${failures.join("\n")}`);
}

console.log(`Captured ${visualCases.length} viewports without horizontal overflow in ${outputDirectory}`);
