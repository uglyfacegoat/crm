import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.AUTH_CHECK_BASE_URL ?? "http://localhost:3010";
const identity = process.env.AUTH_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("AUTH_CHECK_IDENTITY and AUTH_CHECK_PASSWORD are required.");

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

function dateInTimeZone(timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nearbyDateInSameWeek(dateKey) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + (date.getUTCDay() === 0 ? -1 : 1));
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatTimeFromMinutes(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

try {
  await page.goto(`${baseUrl}/clients`, { waitUntil: "networkidle" });
  if (!page.url().includes("/login?next=%2Fclients")) throw new Error(`Protected route did not redirect to login: ${page.url()}`);
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM" }).click();
  await page.waitForURL(`${baseUrl}/clients`);

  const suffix = String(Date.now()).slice(-6);
  const masterName = `Мастер Проверочный ${suffix}`;
  await page.goto(`${baseUrl}/masters`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Новый мастер", exact: true }).click();
  const masterDialog = page.getByRole("dialog", { name: "Новый мастер" });
  await masterDialog.locator('input[name="fullName"]').fill(masterName);
  await masterDialog.locator('input[name="phone"]').fill(`+7 901 ${suffix.slice(0, 3)}-${suffix.slice(3, 5)}-${suffix.slice(5).padStart(2, "0")}`);
  await masterDialog.locator('input[name="messenger"]').fill(`@master_${suffix}`);
  await masterDialog.locator('input[name="basePayment"]').fill("4250.50");
  await masterDialog.locator('input[name="serviceRegion"]').fill("Москва");
  await masterDialog.locator('input[name="serviceZone"]').fill("ЦАО");
  await masterDialog.locator('input[name="skills"]').fill("Дератизация, Дезинсекция");
  await masterDialog.getByRole("button", { name: "Добавить мастера", exact: true }).click();
  await page.getByRole("heading", { name: masterName, exact: true }).waitFor();
  await page.getByPlaceholder("ФИО, телефон, регион, зона…").fill(suffix);
  await page.getByRole("heading", { name: masterName, exact: true }).waitFor();
  await page.getByRole("link", { name: `Открыть карточку мастера ${masterName}` }).click();
  await page.getByRole("button", { name: `Редактировать мастера ${masterName}`, exact: true }).click();
  const editMasterDialog = page.getByRole("dialog", { name: masterName });
  await editMasterDialog.locator('input[name="serviceZone"]').fill("ЦАО · Центр");
  await editMasterDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await editMasterDialog.waitFor({ state: "hidden" });
  await page.getByText("Москва · ЦАО · Центр", { exact: true }).waitFor();
  await page.getByRole("button", { name: `Редактировать мастера ${masterName}`, exact: true }).click();
  const deactivateMasterDialog = page.getByRole("dialog", { name: masterName });
  await deactivateMasterDialog.locator('input[name="operationalStatus"][value="terminated"]').check({ force: true });
  await deactivateMasterDialog.getByPlaceholder("Отпуск до даты, больничный, причина увольнения").fill("Тестовое завершение сотрудничества");
  await deactivateMasterDialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("Уволен", { exact: true }).first().waitFor();

  const quickClientName = `ООО «Мобильный поток ${suffix}»`;
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${baseUrl}/quick-order`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
  await page.getByTestId("quick-client-name").fill(quickClientName);
  await page.getByTestId("quick-tax-id").fill(`7724${suffix}`);
  await page.getByTestId("quick-contact-name").fill("Мобильный Контакт");
  await page.getByTestId("quick-contact-phone").fill(`+7 902 ${suffix.slice(0, 3)}-${suffix.slice(3, 5)}-${suffix.slice(5).padStart(2, "0")}`);
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-object-name").fill(`Мобильный объект ${suffix}`);
  await page.getByTestId("quick-object-address").fill(`Москва, мобильная проверка, ${suffix}`);
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-service-name").fill("Срочная мобильная дезинсекция");
  await page.getByTestId("quick-unit-price").fill("18500");
  await page.getByTestId("quick-next").click();
  await page.getByTestId("quick-visit-date").fill(dateInTimeZone("Europe/Moscow").split("-").reverse().join("."));
  await page.getByTestId("quick-visit-time").fill("09:30");
  await page.waitForFunction(() => {
    const submit = document.querySelector('[data-testid="quick-submit"]');
    return submit instanceof HTMLButtonElement && !submit.disabled;
  }, null, { timeout: 5_000 }).catch(async () => {
    const quickState = await page.locator("body").evaluate((body) => ({
      url: window.location.href,
      text: body.textContent?.slice(0, 3_000),
      inputs: Array.from(body.querySelectorAll("input")).map((input) => ({ type: input.type, value: input.value })),
    }));
    throw new Error(`Quick order submit stayed disabled: ${JSON.stringify({ quickState, pageErrors, consoleErrors })}`);
  });
  await page.getByTestId("quick-submit").click();
  await page.getByTestId("quick-order-success").waitFor();
  await page.getByRole("button", { name: "Карточка мастеру", exact: true }).click();
  const quickDispatchDialog = page.getByRole("dialog", { name: "Карточка выезда" });
  await quickDispatchDialog.getByText(quickClientName, { exact: true }).waitFor();
  const quickDispatchText = await quickDispatchDialog.locator("textarea").inputValue();
  if (!quickDispatchText.includes("Срочная мобильная дезинсекция") || !quickDispatchText.includes("09:30")) {
    throw new Error(`Quick order dispatch card is incomplete: ${quickDispatchText}`);
  }
  const quickWidths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (quickWidths.document > quickWidths.viewport) throw new Error(`Quick order flow overflows at 320px: ${quickWidths.document}px document width.`);
  await quickDispatchDialog.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`${baseUrl}/clients`, { waitUntil: "networkidle" });
  const clientName = `ООО «Проверка ${suffix}»`;
  await page.getByRole("button", { name: "Новый клиент", exact: true }).click();
  await page.getByPlaceholder("ООО «Название»").fill(clientName);
  await page.getByPlaceholder("10 или 12 цифр").fill(`7712${suffix}`);
  await page.getByPlaceholder("Имя сотрудника заказчика").fill("Тестовый Контакт");
  await page.getByPlaceholder("+7 999 000-00-00").fill("+7 999 111-22-33");
  await page.getByPlaceholder("contact@company.ru").fill(`check-${suffix}@example.local`);
  await page.getByRole("button", { name: "Создать клиента" }).click();
  const clientLink = page.getByRole("link", { name: `Открыть клиента ${clientName}`, exact: true }).first();
  await clientLink.waitFor();
  await clientLink.click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);

  const updatedClientName = `${clientName} — обновлён`;
  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  await page.locator('input[name="legalName"]').fill(updatedClientName);
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await page.getByText(updatedClientName, { exact: true }).filter({ visible: true }).first().waitFor().catch(async () => {
    throw new Error(`Calendar did not render the created client. URL: ${page.url()}. Browser errors: ${pageErrors.join("; ")}. Visible page: ${(await page.locator("body").innerText()).slice(0, 2_000)}`);
  });

  const objectName = `Склад ${suffix}`;
  await page.getByRole("button", { name: "Новый объект", exact: true }).click();
  await page.getByPlaceholder("Склад №1").fill(objectName);
  await page.getByPlaceholder("Склад, офис, жилой дом").fill("Склад");
  await page.getByPlaceholder("Москва, ул. Ленина, 15").fill(`Москва, ул. Проверочная, ${suffix}`);
  await page.getByRole("button", { name: "Добавить объект" }).click();
  await page.getByText(objectName, { exact: true }).waitFor();

  const contactName = `Дополнительный Контакт ${suffix}`;
  await page.getByRole("button", { name: "Добавить контакт", exact: true }).click();
  const contactDialog = page.getByRole("dialog", { name: "Новый контакт" });
  await page.getByPlaceholder("Иванова Ирина").fill(contactName);
  await page.getByPlaceholder("+7 999 000-00-00").fill(`+7 900 ${suffix.slice(0, 3)}-${suffix.slice(3, 5)}-${suffix.slice(5).padStart(2, "0")}`);
  await contactDialog.getByRole("button", { name: "Добавить контакт" }).click();
  await page.getByText(contactName, { exact: true }).waitFor();

  await page.goto(`${baseUrl}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Новый заказ", exact: true }).click();
  const orderDialog = page.getByRole("dialog", { name: "Новый заказ" });
  await orderDialog.waitFor({ timeout: 5_000 }).catch(async () => {
    throw new Error(`Order dialog did not open. Browser errors: ${pageErrors.join("; ")}. Visible page: ${(await page.locator("body").innerText()).slice(0, 1_000)}`);
  });
  await orderDialog.locator('summary[aria-label="Клиент"]').click();
  await orderDialog.getByRole("button", { name: updatedClientName, exact: true }).click();
  await orderDialog.locator('summary[aria-label="Объект"]').click();
  await orderDialog.getByRole("button", { name: new RegExp(objectName) }).click();
  await orderDialog.locator('summary[aria-label="Контакт"]').click();
  await orderDialog.getByRole("button", { name: new RegExp("Тестовый Контакт") }).click();
  await orderDialog.getByLabel("Название услуги 1").fill("Комплексная тестовая обработка");
  await orderDialog.getByLabel("Количество услуги 1").fill("1.5");
  await orderDialog.getByLabel("Цена услуги 1").fill("10000");
  await orderDialog.getByRole("button", { name: "Создать заказ", exact: true }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
  const firstOrderUrl = page.url();
  await page.getByText("Комплексная тестовая обработка", { exact: true }).first().waitFor();

  await page.getByRole("button", { name: "Редактировать", exact: true }).click();
  const editOrderDialog = page.getByRole("dialog", { name: "Редактировать заказ" });
  await editOrderDialog.getByRole("button", { name: "В работе", exact: true }).evaluate((button) => button.click());
  await editOrderDialog.getByRole("button", { name: "Сохранить изменения", exact: true }).click();
  await page.getByText("В работе", { exact: true }).first().waitFor();

  await page.getByRole("button", { name: "Расход", exact: true }).click();
  const expenseDialog = page.getByRole("dialog", { name: "Новый расход" });
  await expenseDialog.getByPlaceholder("Топливо, материалы, парковка").fill("Топливо");
  await expenseDialog.getByPlaceholder("1 500").fill("1250.50");
  await expenseDialog.locator('input[name="occurredOn"]').fill("2026-08-27");
  await expenseDialog.getByRole("button", { name: "Добавить расход", exact: true }).click();
  await page.getByText("Топливо", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Добавить выезд", exact: true }).click();
  const createVisitDialog = page.getByRole("dialog", { name: "Новый выезд" });
  const visitDate = addDays(dateInTimeZone("Europe/Moscow"), Number(suffix.slice(-2)) % 21 + 1);
  const visitStartMinutes = 7 * 60 + (Number(suffix) % 44) * 15;
  const initialVisitTime = formatTimeFromMinutes(visitStartMinutes);
  const updatedVisitTime = formatTimeFromMinutes(visitStartMinutes + 15);
  await createVisitDialog.locator('input[name="localDate"]').fill(visitDate);
  await createVisitDialog.locator('input[name="localTime"]').fill(initialVisitTime);
  await createVisitDialog.getByRole("button", { name: "Создать выезд", exact: true }).click();
  await page.getByText("Запланирован", { exact: true }).waitFor();

  await page.getByRole("button", { name: /Редактировать выезд/ }).click();
  const editVisitDialog = page.getByRole("dialog", { name: "Редактировать выезд" });
  const editRescheduleReason = `Клиент уточнил время выезда ${suffix}`;
  const autosaveResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/orders/"));
  await editVisitDialog.getByRole("button", { name: "Подтверждён", exact: true }).click();
  await editVisitDialog.locator('input[name="localTime"]').fill(updatedVisitTime);
  await editVisitDialog.locator('textarea[name="rescheduleReason"]').fill(editRescheduleReason);
  await autosaveResponse;
  await editVisitDialog.getByText("Сохранено", { exact: true }).waitFor();
  await editVisitDialog.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByText("Подтверждён", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Открыть карточку мастеру", exact: true }).first().click();
  const dispatchCardDialog = page.getByRole("dialog", { name: "Карточка выезда" });
  await dispatchCardDialog.getByText(updatedClientName, { exact: true }).waitFor();
  const dispatchText = await dispatchCardDialog.locator("textarea").inputValue();
  if (!dispatchText.includes("Комплексная тестовая обработка") || !dispatchText.includes(updatedVisitTime)) {
    throw new Error(`Dispatch card is missing visit or service data: ${dispatchText}`);
  }
  await dispatchCardDialog.getByRole("button", { name: "Закрыть окно", exact: true }).click();

  const documentTitle = `Акт проверки ${suffix}`;
  await page.goto(`${baseUrl}/documents`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Добавить документ", exact: true }).first().click();
  const documentDialog = page.getByRole("dialog", { name: "Новый документ" });
  await documentDialog.locator('summary[aria-label="Заказ"]').click();
  await documentDialog.getByRole("button", { name: new RegExp(updatedClientName) }).first().click();
  await documentDialog.locator('summary[aria-label="Выезд"]').click();
  await documentDialog.locator('summary[aria-label="Выезд"] + div button').nth(1).click();
  await documentDialog.locator('input[name="title"]').fill(documentTitle);
  await documentDialog.locator('input[name="file"]').setInputFiles({
    name: `act-${suffix}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nCRM verification document\n%%EOF", "ascii"),
  });
  await documentDialog.getByRole("button", { name: "Загрузить документ", exact: true }).click();
  await documentDialog.waitFor({ state: "hidden" });
  await page.getByText(documentTitle, { exact: true }).first().click();
  const downloadLink = page.getByRole("link", { name: "Скачать текущую", exact: true });
  const documentDownloadUrl = await downloadLink.getAttribute("href");
  const downloadPromise = page.waitForEvent("download");
  await downloadLink.click();
  const downloadedDocument = await downloadPromise;
  if (downloadedDocument.suggestedFilename() !== `act-${suffix}.pdf`) throw new Error(`Unexpected document download name: ${downloadedDocument.suggestedFilename()}`);
  await page.getByRole("button", { name: "Закрыть карточку", exact: true }).click();
  await page.getByRole("checkbox", { name: `Добавить ${documentTitle} в архив` }).click();
  const batchDownloadPromise = page.waitForEvent("download").catch(() => null);
  const batchResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/documents/export"));
  await page.getByRole("button", { name: "Скачать ZIP", exact: true }).click();
  const batchResponse = await batchResponsePromise;
  if (!batchResponse.ok()) throw new Error(`Batch export returned ${batchResponse.status()}: ${await batchResponse.text()}`);
  const batchDownload = await batchDownloadPromise;
  if (!batchDownload) throw new Error("Batch export response succeeded without a browser download.");
  if (!/^crm-documents-\d{4}-\d{2}-\d{2}\.zip$/.test(batchDownload.suggestedFilename())) throw new Error(`Unexpected batch export name: ${batchDownload.suggestedFilename()}`);
  const batchDownloadPath = await batchDownload.path();
  if (!batchDownloadPath) throw new Error("Batch export did not produce a local file.");
  const batchArchive = await readFile(batchDownloadPath);
  if (!batchArchive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || !batchArchive.includes(Buffer.from(`act-${suffix}.pdf`, "utf8"))) {
    throw new Error("Batch export is not a valid ZIP with the selected document.");
  }
  const archiveTree = page.getByRole("navigation", { name: "Дерево архива" });
  await archiveTree.getByRole("button").filter({ hasText: updatedClientName }).first().click();
  await page.waitForURL(/\/documents\?client=/);
  await page.getByRole("heading", { name: updatedClientName, exact: true }).waitFor();
  await archiveTree.getByRole("button").filter({ hasText: objectName }).first().click();
  await page.waitForURL(/[?&]object=/);
  await page.getByRole("heading", { name: objectName, exact: true }).waitFor();
  await page.getByText(documentTitle, { exact: true }).first().waitFor();
  await page.goto(firstOrderUrl, { waitUntil: "networkidle" });
  await page.getByText(documentTitle, { exact: true }).waitFor();

  await page.getByRole("button", { name: "Создать серию выездов", exact: true }).click();
  const seriesDialog = page.getByRole("dialog", { name: "Серия выездов" });
  await seriesDialog.getByRole("button", { name: /^Создать \d+ выездов$/ }).click();
  await seriesDialog.getByText(/^Создано выездов: \d+\.$/).waitFor();
  await seriesDialog.waitFor({ state: "hidden" });

  await page.goto(`${baseUrl}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Новый заказ", exact: true }).click();
  const relatedOrderDialog = page.getByRole("dialog", { name: "Новый заказ" });
  await relatedOrderDialog.locator('summary[aria-label="Клиент"]').click();
  await relatedOrderDialog.getByRole("button", { name: updatedClientName, exact: true }).click();
  await relatedOrderDialog.locator('summary[aria-label="Объект"]').click();
  await relatedOrderDialog.getByRole("button", { name: new RegExp(objectName) }).click();
  await relatedOrderDialog.locator('summary[aria-label="Контакт"]').click();
  await relatedOrderDialog.getByRole("button", { name: new RegExp("Тестовый Контакт") }).click();
  await relatedOrderDialog.getByLabel("Название услуги 1").fill("Повторная тестовая обработка");
  await relatedOrderDialog.getByLabel("Количество услуги 1").fill("1");
  await relatedOrderDialog.getByLabel("Цена услуги 1").fill("5000");
  await relatedOrderDialog.getByRole("button", { name: "Создать заказ", exact: true }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);

  await page.getByRole("button", { name: "Связать заказ", exact: true }).click();
  const linkOrderDialog = page.getByRole("dialog", { name: "Связать заказы" });
  await linkOrderDialog.getByRole("button", { name: "Связать заказы", exact: true }).click();
  await linkOrderDialog.getByText("Заказы связаны. Даты выездов объединены автоматически.", { exact: true }).waitFor();
  await linkOrderDialog.waitFor({ state: "hidden" });
  await page.getByText(/^2 заказа · [1-9]\d* общих дат$/).waitFor();
  if (page.url() === firstOrderUrl) throw new Error("The related order unexpectedly reused the first order URL.");

  await page.goto(`${baseUrl}/calendar?date=${visitDate}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1_000);
  const calendarBody = await page.locator("body").innerText();
  if (!calendarBody.includes(updatedClientName)) {
    throw new Error(`Calendar did not render the newly-created visit. Body excerpt: ${calendarBody.slice(0, 4_000)}`);
  }
  const visitDayColumn = page.locator(`[data-calendar-day="${visitDate}"]`);
  const visitCards = visitDayColumn.locator('article[draggable="true"]');
  const cardRectangles = await visitCards.evaluateAll((cards) => cards.map((card) => { const rectangle = card.getBoundingClientRect(); return { title: card.getAttribute("title"), left: rectangle.left, right: rectangle.right, top: rectangle.top, bottom: rectangle.bottom }; }));
  for (let leftIndex = 0; leftIndex < cardRectangles.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cardRectangles.length; rightIndex += 1) {
      const left = cardRectangles[leftIndex];
      const right = cardRectangles[rightIndex];
      const horizontalOverlap = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const verticalOverlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      if (horizontalOverlap > 1 && verticalOverlap > 1) throw new Error(`Calendar visit cards overlap visually: ${JSON.stringify({ left, right })}`);
    }
  }
  const movedDate = nearbyDateInSameWeek(visitDate);
  const rescheduleReason = `Клиент попросил перенести выезд ${suffix}`;
  const sourceVisit = visitDayColumn.locator(`article[draggable="true"][title^="${updatedVisitTime}"]`, { hasText: updatedClientName }).first();
  await sourceVisit.waitFor();
  await sourceVisit.dragTo(page.locator(`[data-calendar-day="${movedDate}"]`), { targetPosition: { x: 60, y: 396 } });
  const moveVisitDialog = page.getByRole("dialog", { name: "Перенести выезд" });
  await moveVisitDialog.getByText("Причина переноса", { exact: false }).first().waitFor();
  await moveVisitDialog.locator('textarea[name="rescheduleReason"]').fill(rescheduleReason);
  await moveVisitDialog.getByRole("button", { name: "Перенести", exact: true }).click();
  await page.getByText(`Выезд перенесён на ${movedDate}, 13:00. Напоминание обновлено.`, { exact: true }).waitFor();
  await page.locator(`[data-calendar-day="${movedDate}"] article[title^="13:00"]`).first().waitFor();
  await page.getByRole("button", { name: "Список", exact: true }).click();
  await page.getByRole("heading", { name: "Расписание всех заказов" }).waitFor();

  await page.goto(firstOrderUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Открыть историю выездов/ }).click();
  const visitHistoryDialog = page.getByRole("dialog", { name: "История выездов" });
  await visitHistoryDialog.getByText("Дата и время перенесены", { exact: true }).first().waitFor();
  await visitHistoryDialog.getByText(`Причина переноса: ${editRescheduleReason}`, { exact: true }).waitFor();
  await visitHistoryDialog.getByText(`Причина переноса: ${rescheduleReason}`, { exact: true }).waitFor();
  await visitHistoryDialog.getByText(/Изменил:/).first().waitFor();
  await visitHistoryDialog.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.getByRole("button", { name: /Завершить выезд .* с актом/ }).first().click();
  const completionDialog = page.getByRole("dialog", { name: "Завершить выезд" });
  const completionActTitle = `Закрывающий акт ${suffix}`;
  await completionDialog.locator('input[name="actTitle"]').fill(completionActTitle);
  await completionDialog.locator('textarea[name="completionNotes"]').fill("Работы выполнены полностью, контрольный осмотр проведён.");
  await completionDialog.locator('input[name="file"]').setInputFiles({
    name: `closing-act-${suffix}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nCRM closing act verification\n%%EOF", "ascii"),
  });
  await completionDialog.getByRole("button", { name: "Завершить с актом", exact: true }).click();
  await completionDialog.getByText("Выезд завершён, акт добавлен в архив.", { exact: true }).waitFor();
  await completionDialog.waitFor({ state: "hidden" });
  await page.getByText("Завершён", { exact: true }).first().waitFor();
  const closingActLink = page.getByRole("link", { name: new RegExp(`Скачать закрывающий акт ${completionActTitle}`) });
  await closingActLink.waitFor();
  const closingActDownload = page.waitForEvent("download");
  await closingActLink.click();
  if ((await closingActDownload).suggestedFilename() !== `closing-act-${suffix}.pdf`) throw new Error("Closing act download filename does not match the uploaded file.");

  await page.goto(`${baseUrl}/analytics?range=30`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Динамика по заказам" }).waitFor();
  await page.getByText("Плановый опер. остаток", { exact: true }).first().waitFor();
  if (process.env.AUTH_CHECK_ANALYTICS_SCREENSHOT_PATH) await page.screenshot({ path: process.env.AUTH_CHECK_ANALYTICS_SCREENSHOT_PATH, fullPage: true });

  await page.goto(`${baseUrl}/tasks`, { waitUntil: "networkidle" });
  await page.getByText(/Подготовить выезд №/).first().waitFor();
  const taskName = `Проверка задачи ${suffix}`;
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  const taskDialog = page.getByRole("dialog", { name: "Новая задача" });
  await taskDialog.getByPlaceholder("Например, отправить акт клиенту").fill(taskName);
  await taskDialog.getByRole("button", { name: "Создать задачу", exact: true }).click();
  await page.getByText(taskName, { exact: true }).waitFor();
  const createdTask = page.locator("article").filter({ hasText: taskName });
  await createdTask.getByRole("button", { name: /Отметить задачу/ }).click();
  await createdTask.waitFor({ state: "detached" });

  await page.goto(`${baseUrl}/chat`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Общий чат", exact: true }).waitFor();
  const generalMessage = `Проверка общего чата ${suffix}`;
  await page.getByPlaceholder("Напишите сообщение…").fill(generalMessage);
  await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.getByText(generalMessage, { exact: true }).waitFor();
  const groupName = `Штаб ${suffix}`;
  await page.getByRole("button", { name: "Новая группа", exact: true }).first().click();
  const groupDialog = page.getByRole("dialog", { name: "Новая группа" });
  await groupDialog.getByPlaceholder("Например, Диспетчерская").fill(groupName);
  await groupDialog.getByPlaceholder("Для каких вопросов создана группа").fill("Группа сквозной проверки CRM");
  await groupDialog.getByRole("button", { name: "Создать группу", exact: true }).click();
  await page.waitForURL(/\/chat\?channel=[0-9a-f-]{36}$/);
  await page.getByRole("heading", { name: groupName, exact: true }).waitFor();
  const groupMessage = `Сообщение группы ${suffix}`;
  await page.getByPlaceholder("Напишите сообщение…").fill(groupMessage);
  await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.getByText(groupMessage, { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(groupMessage, { exact: true }).waitFor();

  const searchResponse = await page.request.get(`${baseUrl}/api/v1/search?q=${encodeURIComponent(updatedClientName)}`);
  if (searchResponse.status() !== 200) throw new Error(`Authenticated global search returned ${searchResponse.status()} instead of 200.`);
  const searchPayload = await searchResponse.json();
  if (!searchPayload.data?.results?.some((result) => result.entityType === "client" && result.title === updatedClientName)) {
    throw new Error(`Global search did not return the created client: ${JSON.stringify(searchPayload).slice(0, 2_000)}`);
  }
  const notificationsResponse = await page.request.get(`${baseUrl}/api/v1/notifications?limit=20`);
  if (notificationsResponse.status() !== 200) throw new Error(`Authenticated notifications returned ${notificationsResponse.status()} instead of 200.`);
  const notificationsPayload = await notificationsResponse.json();
  if (!Array.isArray(notificationsPayload.data?.items) || !Number.isInteger(notificationsPayload.data?.unreadCount)) {
    throw new Error(`Notifications API returned an invalid snapshot: ${JSON.stringify(notificationsPayload).slice(0, 2_000)}`);
  }
  const unreadNotification = notificationsPayload.data.items.find((notification) => notification.readAt === null);
  if (unreadNotification) {
    const readResponse = await page.request.post(`${baseUrl}/api/v1/notifications/${encodeURIComponent(unreadNotification.id)}/read`);
    if (readResponse.status() !== 200) throw new Error(`Notification read returned ${readResponse.status()} instead of 200.`);
  }
  await page.goto(`${baseUrl}/notifications`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Центр уведомлений", exact: true }).waitFor();
  await page.getByRole("button", { name: "Обновить уведомления", exact: true }).click();
  await page.getByRole("button", { name: "Открыть глобальный поиск", exact: true }).click();
  const globalSearchDialog = page.getByRole("dialog", { name: "Глобальный поиск" });
  await globalSearchDialog.getByRole("combobox").fill(updatedClientName);
  const clientSearchResult = globalSearchDialog.getByRole("option").filter({ hasText: updatedClientName }).first();
  await clientSearchResult.waitFor();
  await clientSearchResult.click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);

  for (const searchViewport of [{ width: 320, height: 568 }, { width: 3840, height: 2160 }]) {
    await page.setViewportSize(searchViewport);
    await page.goto(`${baseUrl}/clients`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Открыть глобальный поиск", exact: true }).click();
    const responsiveSearchDialog = page.getByRole("dialog", { name: "Глобальный поиск" });
    await responsiveSearchDialog.getByRole("combobox").fill(updatedClientName);
    await responsiveSearchDialog.getByRole("option").filter({ hasText: updatedClientName }).first().waitFor();
    const searchWidths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    const dialogRectangle = await responsiveSearchDialog.boundingBox();
    if (searchWidths.document > searchWidths.viewport || !dialogRectangle || dialogRectangle.width > searchWidths.viewport) {
      throw new Error(`Global search overflows at ${searchViewport.width}px: ${JSON.stringify({ searchWidths, dialogRectangle })}`);
    }
    await responsiveSearchDialog.getByRole("button", { name: "Закрыть поиск", exact: true }).click();
  }

  for (const responsiveCase of [
    { path: "/quick-order", width: 320, height: 568 },
    { path: "/masters", width: 320, height: 568 },
    { path: `/calendar?date=${visitDate}`, width: 320, height: 568 },
    { path: "/analytics?range=30", width: 320, height: 568 },
    { path: "/tasks", width: 320, height: 568 },
    { path: "/documents", width: 320, height: 568 },
    { path: "/chat", width: 320, height: 568 },
    { path: "/notifications", width: 320, height: 568 },
    { path: "/quick-order", width: 3840, height: 2160 },
    { path: "/masters", width: 3840, height: 2160 },
    { path: `/calendar?date=${visitDate}`, width: 3840, height: 2160 },
    { path: "/analytics?range=365", width: 3840, height: 2160 },
    { path: "/documents", width: 3840, height: 2160 },
    { path: "/chat", width: 3840, height: 2160 },
    { path: "/notifications", width: 3840, height: 2160 },
  ]) {
    await page.setViewportSize({ width: responsiveCase.width, height: responsiveCase.height });
    await page.goto(`${baseUrl}${responsiveCase.path}`, { waitUntil: "networkidle" });
    const widths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    if (widths.document > widths.viewport) throw new Error(`${responsiveCase.path} overflows horizontally at ${responsiveCase.width}px: ${widths.document}px document width.`);
    if (responsiveCase.path.startsWith("/analytics")) {
      const chart = page.locator(".recharts-responsive-container").first();
      await chart.waitFor();
      const rectangle = await chart.boundingBox();
      if (!rectangle || rectangle.width < 200 || rectangle.height < 288) throw new Error(`Analytics chart has invalid geometry at ${responsiveCase.width}px: ${JSON.stringify(rectangle)}`);
      if (responsiveCase.width === 3840 && process.env.AUTH_CHECK_SCREENSHOT_PATH) await page.screenshot({ path: process.env.AUTH_CHECK_SCREENSHOT_PATH, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(`${baseUrl}/calendar?date=${visitDate}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Открыть карточку мастеру", exact: true }).first().click();
  const mobileDispatchDialog = page.getByRole("dialog", { name: "Карточка выезда" });
  await mobileDispatchDialog.getByRole("button", { name: "Скопировать для мастера", exact: true }).waitFor();
  const mobileWidths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (mobileWidths.document > mobileWidths.viewport) throw new Error(`Dispatch dialog overflows horizontally at 320px: ${mobileWidths.document}px document width.`);
  await mobileDispatchDialog.getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.getByRole("button", { name: /^Перенести выезд/ }).first().click();
  await page.getByRole("dialog", { name: "Перенести выезд" }).waitFor();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await page.goto(firstOrderUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Открыть историю выездов/ }).click();
  await page.getByRole("dialog", { name: "История выездов" }).getByText("Дата и время перенесены", { exact: true }).first().waitFor();
  const historyWidths = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (historyWidths.document > historyWidths.viewport) throw new Error(`Visit history dialog overflows horizontally at 320px: ${historyWidths.document}px document width.`);
  await page.getByRole("dialog", { name: "История выездов" }).getByRole("button", { name: "Закрыть окно", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.locator("header details > summary").click();
  await page.getByRole("banner").getByRole("button", { name: "Выйти", exact: true }).click();
  await page.waitForURL(`${baseUrl}/login`);
  if (!documentDownloadUrl) throw new Error("Document download URL was not rendered.");
  const unauthorizedDownload = await page.request.get(`${baseUrl}${documentDownloadUrl}`);
  if (unauthorizedDownload.status() !== 401) throw new Error(`Unauthenticated document download returned ${unauthorizedDownload.status()} instead of 401.`);
  const unauthorizedSearch = await page.request.get(`${baseUrl}/api/v1/search?q=проверка`);
  if (unauthorizedSearch.status() !== 401) throw new Error(`Unauthenticated global search returned ${unauthorizedSearch.status()} instead of 401.`);
  const unauthorizedNotifications = await page.request.get(`${baseUrl}/api/v1/notifications`);
  if (unauthorizedNotifications.status() !== 401) throw new Error(`Unauthenticated notifications returned ${unauthorizedNotifications.status()} instead of 401.`);
  if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join("; ")}`);
  if (consoleErrors.length) throw new Error(`Browser console errors: ${consoleErrors.join("; ")}`);
  console.log("Verified login, master CRUD and filters, atomic mobile quick order, client CRUD, server-side global search, personal notifications and read state, order creation, expense accounting, visit autosave and history, transactional completion with a closing act, secure documents, batch ZIP export and archive navigation, general chat messaging, group creation and persistence, recurrence reminders, related-order aggregation, calendar drag-and-drop, analytics, task CRUD, responsive layouts, and logout.");
} finally {
  await browser.close();
}
