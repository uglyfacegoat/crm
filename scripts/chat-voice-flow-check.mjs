import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.CHAT_VOICE_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.CHAT_VOICE_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.CHAT_VOICE_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;

if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Chat voice flow credentials are required.");

const browser = await chromium.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
const page = await context.newPage();
const errors = [];
mkdirSync("artifacts/design", { recursive: true });
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${baseUrl}/chat`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/login") {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/chat");
  }

  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await page.getByRole("button", { name: "Поставить запись на паузу", exact: true }).waitFor();
  assert.equal(await page.locator("form [data-voice-waveform] > span").count(), 42);

  await page.getByRole("button", { name: "Поставить запись на паузу", exact: true }).click();
  await page.getByRole("button", { name: "Продолжить запись", exact: true }).waitFor();
  const pausedTime = await page.locator("form .tabular-nums").innerText();
  await page.waitForTimeout(1_100);
  assert.equal(await page.locator("form .tabular-nums").innerText(), pausedTime, "Paused recordings must not advance the timer.");
  await page.screenshot({ path: "artifacts/design/chat-voice-paused.png" });
  await page.getByRole("button", { name: "Продолжить запись", exact: true }).click();
  await page.waitForTimeout(1_100);
  await page.getByRole("button", { name: "Завершить запись", exact: true }).click();

  await page.getByRole("button", { name: "Отправить голосовое сообщение", exact: true }).waitFor();
  assert.equal(await page.locator("form [data-voice-player]").count(), 1);
  assert.equal(await page.locator("audio[controls]").count(), 0, "Native audio controls must not be exposed.");
  await page.locator("form").getByRole("button", { name: "Изменить скорость воспроизведения", exact: true }).click();
  assert.equal(await page.locator("form").getByRole("button", { name: "Изменить скорость воспроизведения", exact: true }).innerText(), "1.5×");
  await page.screenshot({ path: "artifacts/design/chat-voice-draft.png" });
  await page.getByRole("button", { name: "Удалить голосовой черновик", exact: true }).click();
  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).waitFor();
  assert.equal(await page.locator('input[name="file"]').evaluate((input) => input.files.length), 0, "Discarding a voice draft must remove its upload file, not only its preview.");

  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("form .tabular-nums")?.textContent === "00:01");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      File.prototype.arrayBuffer = original;
      return new Promise((resolve, reject) => {
        window.__releaseVoicePreparation = () => original.call(this).then(resolve, reject);
      });
    };
  });
  await page.getByRole("button", { name: "Завершить запись", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Подготовка голосового" }).waitFor();
  await page.getByRole("button", { name: "Удалить голосовой черновик", exact: true }).click();
  await page.waitForFunction(() => typeof window.__releaseVoicePreparation === "function");
  await page.evaluate(async () => {
    await window.__releaseVoicePreparation();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).waitFor();
  assert.equal(await page.locator("form [data-voice-player]").count(), 0, "Cancelled preparation must not restore a deleted draft.");
  assert.equal(await page.locator('input[name="file"]').evaluate((input) => input.files.length), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await page.getByRole("button", { name: "Удалить голосовое сообщение", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Voice recorder must not overflow the mobile viewport.");
  await page.getByRole("button", { name: "Удалить голосовое сообщение", exact: true }).click();
  await page.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).waitFor();

  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`);
  console.log(JSON.stringify({ operation: "chat.voice_flow_check", status: "succeeded", waveformBars: 42, pauseResume: true, draftDelete: true, cancelledPreparation: true, nativeControls: false }));
} finally {
  await browser.close();
}
