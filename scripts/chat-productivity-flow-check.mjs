import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.CHAT_PRODUCTIVITY_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.CHAT_PRODUCTIVITY_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.CHAT_PRODUCTIVITY_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;

if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Chat productivity flow credentials are required.");

const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const browserErrors = [];
mkdirSync("artifacts/design", { recursive: true });
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/chat`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname !== "/login");
    await page.goto(`${baseUrl}/chat`, { waitUntil: "networkidle" });
  }

  const workspace = page.getByTestId("chat-workspace");
  if (await workspace.getAttribute("data-channels-collapsed") === "true") {
    await page.getByRole("button", { name: "Развернуть список каналов", exact: true }).click();
  }
  await page.getByText("Группы", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Новое личное сообщение", exact: true }).first().click();
  const directDialog = page.getByRole("dialog", { name: "Новое личное сообщение" });
  await directDialog.waitFor();
  const peerOptions = directDialog.locator('input[name="targetMemberId"]');
  assert.ok(await peerOptions.count(), "An active peer account is required for direct chat verification.");
  await peerOptions.first().locator("xpath=..").click();
  await directDialog.getByRole("button", { name: "Открыть диалог", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/chat" && Boolean(url.searchParams.get("channel")));
  await page.getByRole("tab", { name: /^Личные/ }).waitFor();
  await page.locator('[aria-label="В сети"], [aria-label="Не в сети"]').first().waitFor();

  let personalMessages = page.locator('[data-chat-message="user"]');
  if (await personalMessages.count() === 0) {
    const initialComposer = page.locator("form").filter({ has: page.locator('textarea[name="body"]') });
    await initialComposer.locator('textarea[name="body"]').fill("Личный чат готов к работе 👋");
    await initialComposer.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await personalMessages.first().waitFor();
  }
  personalMessages = page.locator('[data-chat-message="user"]');
  const personalMessageCount = await personalMessages.count();
  for (let index = 0; index < personalMessageCount; index += 1) {
    const message = personalMessages.nth(index);
    const authorName = await message.getAttribute("data-chat-author");
    assert.ok(authorName, "Every user message must retain its system author name.");
    assert.match(await message.getByTestId("chat-message-author").innerText(), new RegExp(authorName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const reactionMessage = personalMessages.last();
  const rocketReaction = reactionMessage.getByRole("button").filter({ hasText: "🚀" });
  if (await rocketReaction.count() === 0) {
    await reactionMessage.hover();
    await reactionMessage.locator('[aria-label="Все реакции"]').click();
    await reactionMessage.getByRole("button", { name: "Вставить 🚀", exact: true }).click();
    await rocketReaction.waitFor();
  }

  const activeChannel = page.locator('button[aria-current="page"]');
  await activeChannel.waitFor();
  const pinButton = activeChannel.locator("xpath=..").getByRole("button", { name: /^(Закрепить|Открепить) чат / });
  await pinButton.waitFor();
  const pinLabel = await pinButton.getAttribute("aria-label");
  assert.ok(pinLabel, "The personal chat must expose a pin control with the peer's display name.");
  await pinButton.click();
  const nextPinLabel = pinLabel.startsWith("Закрепить") ? pinLabel.replace("Закрепить", "Открепить") : pinLabel.replace("Открепить", "Закрепить");
  await page.getByRole("button", { name: nextPinLabel, exact: true }).waitFor();

  const composer = page.locator("form").filter({ has: page.locator('textarea[name="body"]') });
  const textarea = composer.locator('textarea[name="body"]');
  await composer.getByRole("button", { name: "Добавить объект системы", exact: true }).click();
  const entityDialog = page.getByRole("dialog", { name: "Добавить объект системы" });
  await entityDialog.waitFor();
  assert.ok(await entityDialog.getByRole("tab").count(), "The CRM object picker must expose at least one permitted entity type.");
  const entityLinksBeforeSend = await page.getByRole("link", { name: /^Открыть:/ }).count();
  await entityDialog.getByRole("tabpanel").getByRole("button").first().click();
  await entityDialog.waitFor({ state: "hidden" });
  await composer.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.getByRole("link", { name: /^Открыть:/ }).nth(entityLinksBeforeSend).waitFor();
  await composer.locator('[aria-label="Добавить эмодзи в сообщение"]').click();
  await composer.getByRole("button", { name: "Вставить 🚀", exact: true }).click();
  assert.equal(await textarea.inputValue(), "🚀");
  await textarea.fill("");

  await page.screenshot({ path: "artifacts/design/chat-personal-and-emoji.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Chat must not overflow the mobile viewport.");

  if (browserErrors.length) throw new Error(`Browser errors: ${JSON.stringify(browserErrors)}`);
  console.log(JSON.stringify({ operation: "chat.productivity_flow_check", status: "succeeded", userMessagesChecked: personalMessageCount, directChat: true, onlinePresence: true, entityPicker: true, pinToggle: true, reactionPicker: true, emojiPicker: true, mobileOverflow: false }));
} finally {
  await browser.close();
}
