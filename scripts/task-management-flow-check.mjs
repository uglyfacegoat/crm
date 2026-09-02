import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.TASK_MANAGEMENT_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.TASK_MANAGEMENT_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.TASK_MANAGEMENT_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("TASK_MANAGEMENT_CHECK_IDENTITY and TASK_MANAGEMENT_CHECK_PASSWORD are required.");

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/tasks`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/tasks`);
  }

  const suffix = String(Date.now()).slice(-6);
  const originalTitle = `Проверка задач ${suffix}`;
  const editedTitle = `${originalTitle} — изменена`;
  await page.getByRole("button", { name: "Новая задача" }).click();
  const createDialog = page.getByRole("dialog", { name: "Новая задача" });
  await createDialog.locator('input[name="title"]').fill(originalTitle);
  await createDialog.locator('textarea[name="description"]').fill("Интеграционная проверка назначения и истории.");
  await createDialog.getByText("Высокий", { exact: true }).click();
  await createDialog.getByRole("button", { name: "Создать задачу" }).click();
  await createDialog.waitFor({ state: "hidden" });
  await page.getByText(originalTitle, { exact: true }).waitFor();

  await page.getByRole("button", { name: `Действия с задачей ${originalTitle}` }).click();
  await page.getByRole("menuitem", { name: "Редактировать" }).click();
  const editDialog = page.getByRole("dialog", { name: "Редактировать задачу" });
  await editDialog.locator('input[name="title"]').fill(editedTitle);
  const assigneeSelect = editDialog.locator('select[name="assignedMemberId"]');
  const assigneeOptions = assigneeSelect.locator("option");
  if (await assigneeOptions.count() > 2) {
    const alternativeAssignee = await assigneeOptions.nth((await assigneeOptions.count()) - 1).getAttribute("value");
    if (alternativeAssignee) await assigneeSelect.selectOption(alternativeAssignee);
  }
  await editDialog.getByRole("button", { name: "Сохранить" }).click();
  await editDialog.waitFor({ state: "hidden" });
  await page.getByText(editedTitle, { exact: true }).waitFor();

  await page.getByRole("button", { name: `Действия с задачей ${editedTitle}` }).click();
  await page.getByRole("menuitem", { name: "История" }).click();
  const historyDialog = page.getByRole("dialog", { name: "История задачи" });
  await historyDialog.getByText("Задача создана", { exact: true }).waitFor();
  await historyDialog.getByText("Задача изменена", { exact: true }).waitFor();
  await page.setViewportSize({ width: 3840, height: 2160 });
  const historyBox = await historyDialog.boundingBox();
  if (!historyBox || historyBox.x < -1 || historyBox.x + historyBox.width > 3841) throw new Error(`Task history overflows the 4K viewport: ${JSON.stringify(historyBox)}`);
  await historyDialog.getByRole("button", { name: "Закрыть окно" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: `Действия с задачей ${editedTitle}` }).click();
  await page.getByRole("menuitem", { name: "Отменить задачу" }).click();
  const cancelDialog = page.getByRole("dialog", { name: "Отменить задачу" });
  await cancelDialog.locator("textarea").fill("Тестовый сценарий успешно завершён");
  await cancelDialog.getByRole("button", { name: "Отменить задачу" }).click();
  await cancelDialog.waitFor({ state: "hidden" });
  await page.getByText(editedTitle, { exact: true }).waitFor({ state: "hidden" });

  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
  process.stdout.write(`${JSON.stringify({ originalTitle, editedTitle })}\n`);
} finally {
  await browser.close();
}
