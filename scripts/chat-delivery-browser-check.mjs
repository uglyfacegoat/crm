import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, cp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";
import sharp from "sharp";
import { runMigrations } from "./migrate.mjs";

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!adminUrl || process.env.CRM_TEST_FIXTURE_URL !== adminUrl || !process.env.CHAT_CHECK_RUNTIME || !process.env.CHROME_PATH) {
  throw new Error("Run with isolated PostgreSQL, CHAT_CHECK_RUNTIME and CHROME_PATH.");
}

const baseUrl = "http://127.0.0.1:3135";
const directory = await mkdtemp(join(tmpdir(), "crm-chat-delivery-"));
const databaseName = `crm_chat_delivery_${randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl); url.pathname = `/${databaseName}`;
const accounts = {
  developer: { email: "developer@chat-delivery.invalid", password: randomBytes(32).toString("hex"), name: "Разработчик" },
  sender: { email: "sender@chat-delivery.invalid", password: randomBytes(32).toString("hex"), name: "Макс", role: "owner" },
  recipient: { email: "recipient@chat-delivery.invalid", password: randomBytes(32).toString("hex"), name: "Лиза", role: "crm_coordinator" },
};
const environment = { ...process.env, DATABASE_URL: url.toString(), AUTH_MODE: "required",
  CRM_ALLOWED_ORIGINS: baseUrl, CRM_TRUST_PROXY: "false", AUTH_COOKIE_SECURE: "false",
  AUTH_THROTTLE_SECRET: randomBytes(32).toString("hex"), DOCUMENT_STORAGE_ROOT: directory,
  AUTH_BOOTSTRAP_ADMIN_NAME: accounts.developer.name, AUTH_BOOTSTRAP_ADMIN_EMAIL: accounts.developer.email,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: accounts.developer.password, AUTH_BOOTSTRAP_ORGANIZATION_NAME: "Chat delivery acceptance",
  AUTH_BOOTSTRAP_TIMEZONE: "Europe/Moscow", AUTH_BOOTSTRAP_DEVELOPER: "true",
  NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: "3135" };
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
let sql; let server; let serverExit; let browser; let created = false;

async function login(page, account) {
  await page.goto(`${baseUrl}/login`);
  await page.getByPlaceholder("Email или телефон").fill(account.email);
  await page.getByPlaceholder("Пароль").fill(account.password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((current) => current.pathname === "/");
}

async function voiceFixture(extension = "webm") {
  const sampleRate = 22_050;
  const samples = sampleRate * 3;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) wav.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 1200), 44 + index * 2);
  const outputPath = join(directory, `voice-fixture.${extension}`);
  const encoded = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "wav", "-i", "pipe:0", "-c:a", extension === "webm" ? "libopus" : "aac", "-y", outputPath], { input: wav });
  assert.equal(encoded.status, 0);
  return readFile(outputPath);
}

try {
  await admin`CREATE DATABASE ${admin(databaseName)}`; created = true;
  await runMigrations({ databaseUrl: url.toString(), onApplied: () => {} });
  const bootstrap = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-admin.ts"], { env: environment, stdio: "inherit" });
  assert.equal(bootstrap.status, 0);
  sql = postgres(url.toString(), { max: 2, onnotice: () => {} });
  const [organization] = await sql`SELECT organization_id FROM organization_members WHERE email = ${accounts.developer.email}`;
  for (const account of [accounts.sender, accounts.recipient]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/create-member.ts"], {
      env: { ...environment, AUTH_MEMBER_ORGANIZATION_ID: organization.organization_id,
        AUTH_MEMBER_NAME: account.name, AUTH_MEMBER_EMAIL: account.email,
        AUTH_MEMBER_PASSWORD: account.password, AUTH_MEMBER_ROLE: account.role }, stdio: "inherit",
    });
    assert.equal(result.status, 0);
  }

  const runtime = resolve(process.env.CHAT_CHECK_RUNTIME);
  await cp(join(dirname(dirname(runtime)), "static"), join(dirname(runtime), ".next/static"), { recursive: true, force: true });
  await cp(resolve("public"), join(dirname(runtime), "public"), { recursive: true, force: true });
  server = spawn(process.execPath, [runtime], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  serverExit = once(server, "exit");
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await new Promise((ready, reject) => {
    const timeout = setTimeout(() => reject(new Error("Standalone startup exceeded 30 seconds")), 30_000);
    server.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Standalone exited ${code}`)); });
    server.stdout.on("data", (chunk) => { if (chunk.toString().includes("Ready in")) { clearTimeout(timeout); ready(); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const sender = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const recipient = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await Promise.all([login(sender, accounts.sender), login(recipient, accounts.recipient)]);
  await sender.goto(`${baseUrl}/chat`);
  const [channel] = await sql`SELECT id FROM chat_channels WHERE organization_id = ${organization.organization_id} AND kind = 'general'`;
  assert.ok(channel?.id);
  await recipient.goto(`${baseUrl}/chat?channel=${channel.id}`);
  const message = `Проверка живой доставки ${randomUUID()}`;
  const received = recipient.locator('[data-chat-message="user"]').filter({ hasText: message });
  await sender.locator('textarea[name="body"]').fill(message);
  const startedAt = Date.now();
  await sender.getByRole("button", { name: "Отправить сообщение" }).click();
  await received.waitFor({ timeout: 15_000 });
  const elapsedMs = Date.now() - startedAt;
  const [stored] = await sql`SELECT messages.id, authors.display_name FROM chat_messages messages
    JOIN organization_members authors ON authors.organization_id = messages.organization_id AND authors.id = messages.author_id
    WHERE messages.organization_id = ${organization.organization_id} AND messages.channel_id = ${channel.id} AND messages.body = ${message}`;
  assert.equal(stored.display_name, accounts.sender.name);
  assert.equal(await received.count(), 1);
  assert.ok(elapsedMs < 15_000, `Message arrived after ${elapsedMs}ms`);
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    permissions: ["microphone"] });
  const mobile = await mobileContext.newPage();
  await login(mobile, accounts.recipient);
  await mobile.goto(`${baseUrl}/chat?channel=${channel.id}`);
  const reply = `Проверка ответа с телефона ${randomUUID()}`;
  const input = mobile.locator('textarea[name="body"]');
  await input.fill(reply);
  await input.press("Enter");
  assert.equal(await input.inputValue(), `${reply}\n`);
  assert.equal((await sql`SELECT id FROM chat_messages WHERE body = ${reply}`).length, 0);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
  const replyReceived = sender.locator('[data-chat-message="user"]').filter({ hasText: reply });
  await mobile.getByRole("button", { name: "Отправить сообщение" }).click();
  await replyReceived.waitFor({ timeout: 15_000 });
  assert.equal((await sql`SELECT id FROM chat_messages WHERE body = ${reply}`).length, 1);

  const voiceId = await sender.locator('input[name="idempotencyKey"]').inputValue();
  await sender.locator('input[name="file"]').setInputFiles({ name: "voice.webm", mimeType: "audio/webm", buffer: await voiceFixture() });
  await sender.getByText("voice.webm").waitFor();
  await sender.getByRole("button", { name: "Отправить сообщение" }).click();
  await sender.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, voiceId, { timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}; composer alert: ${await sender.locator('form [role="alert"]').allTextContents()}`);
  });
  const [voice] = await sql`SELECT id FROM chat_message_attachments WHERE message_id = ${voiceId}`;
  assert.ok(voice?.id);
  const mobilePlayer = mobile.locator("[data-voice-player]").filter({ has: mobile.locator(`audio[src*="${voice.id}"]`) });
  const voiceBubble = mobile.locator('[data-chat-message="user"]').filter({ has: mobile.locator("[data-voice-player]") });
  await voiceBubble.first().waitFor({ timeout: 15_000 });
  const audioResponses = [];
  mobile.on("response", (response) => {
    if (response.url().includes(voice.id) && response.url().includes("format=mp3")) audioResponses.push(response.status());
  });
  await mobile.locator("[data-voice-player]").first().getByRole("button", { name: "Воспроизвести голосовое" }).click();
  await mobilePlayer.waitFor();
  await mobile.waitForFunction((id) => {
    const audio = document.querySelector(`audio[src*="${id}"]`);
    return audio && audio.currentTime > 0.2;
  }, voice.id, { timeout: 15_000 });
  assert.equal(await mobilePlayer.getByText("Ошибка воспроизведения").count(), 0);
  assert.ok(audioResponses.some((status) => status === 200 || status === 206));
  const messageList = mobile.getByTestId("chat-message-list");
  await messageList.evaluate((element) => {
    element.style.height = "70px";
    element.style.maxHeight = "70px";
    element.style.overflowY = "auto";
    element.scrollTop = 0;
  });
  await mobile.waitForFunction(() => !document.querySelector('[data-voice-player] audio')?.hasAttribute("src"), null, { timeout: 5_000 });
  const responsesBeforeReload = audioResponses.length;
  await messageList.evaluate((element) => {
    element.style.height = "";
    element.style.maxHeight = "";
    element.style.overflowY = "";
  });
  await voiceBubble.first().getByRole("button", { name: "Воспроизвести голосовое" }).click();
  await mobile.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`)?.currentTime > 0.2, voice.id, { timeout: 15_000 });
  assert.ok(audioResponses.length > responsesBeforeReload, "An off-screen voice should reload only after a new click");

  const m4aId = await sender.locator('input[name="idempotencyKey"]').inputValue();
  await sender.locator('input[name="file"]').setInputFiles({ name: "voice.m4a", mimeType: "audio/mp4", buffer: await voiceFixture("m4a") });
  await sender.getByText("voice.m4a").waitFor();
  await sender.getByRole("button", { name: "Отправить сообщение" }).click();
  await sender.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, m4aId, { timeout: 10_000 });
  const [m4a] = await sql`SELECT id FROM chat_message_attachments WHERE message_id = ${m4aId}`;
  assert.ok(m4a?.id);
  await mobile.locator("[data-voice-player]").filter({ has: mobile.locator(`audio[src*="${voice.id}"]`) }).waitFor();
  const m4aPlayers = mobile.locator("[data-voice-player]");
  await mobile.waitForFunction(() => document.querySelectorAll("[data-voice-player]").length >= 2, null, { timeout: 15_000 });
  await m4aPlayers.last().getByRole("button", { name: "Воспроизвести голосовое" }).click();
  await mobile.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`)?.currentTime > 0.2, m4a.id, { timeout: 15_000 });
  assert.equal(await m4aPlayers.last().getByText("Ошибка воспроизведения").count(), 0);

  await mobile.getByRole("button", { name: "Записать голосовое сообщение" }).click();
  await mobile.getByRole("button", { name: "Остановить запись и прослушать" }).waitFor();
  await mobile.waitForTimeout(1_100);
  await mobile.getByRole("button", { name: "Остановить запись и прослушать" }).click();
  const draft = mobile.locator("form [data-voice-player]");
  await draft.getByRole("button", { name: "Воспроизвести голосовое" }).waitFor({ timeout: 15_000 });
  await draft.getByRole("button", { name: "Воспроизвести голосовое" }).click();
  await mobile.waitForFunction(() => {
    const audio = document.querySelector("form [data-voice-player] audio");
    return audio?.currentSrc.startsWith("blob:") && !audio.currentSrc.includes("?load=") && audio.currentTime > 0.1;
  }, null, { timeout: 15_000 });
  assert.equal(await draft.getByText("Ошибка воспроизведения").count(), 0);
  await mobile.getByRole("button", { name: "Удалить голосовой черновик" }).click();

  const photoBuffer = await sharp({ create: { width: 720, height: 900, channels: 3, background: "#6a83ab" } }).png().toBuffer();
  await mobile.route("**/api/v1/chat/attachments/*/download?preview=1*", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 900));
    await route.continue();
  });
  const photoId = await sender.locator('input[name="idempotencyKey"]').inputValue();
  await sender.locator('input[name="file"]').setInputFiles({ name: "team-photo.png", mimeType: "image/png", buffer: photoBuffer });
  await sender.getByAltText("Предпросмотр выбранного фото").waitFor();
  await sender.getByRole("button", { name: "Отправить сообщение" }).click();
  await sender.waitForFunction((id) => document.querySelector('input[name="idempotencyKey"]')?.value !== id, photoId, { timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}; photo composer alert: ${await sender.locator('form [role="alert"]').allTextContents()}`);
  });
  const [photo] = await sql`SELECT attachments.id, messages.body, messages.body_is_placeholder
    FROM chat_message_attachments attachments
    JOIN chat_messages messages ON messages.organization_id = attachments.organization_id AND messages.id = attachments.message_id
    WHERE attachments.message_id = ${photoId}`;
  assert.ok(photo?.id);
  assert.equal(photo.body, "Фото");
  assert.equal(photo.body_is_placeholder, true);
  const photoMessage = mobile.locator('[data-chat-message="user"]').filter({ has: mobile.locator(`img[src*="${photo.id}"]`) });
  await photoMessage.waitFor({ timeout: 15_000 });
  await photoMessage.scrollIntoViewIfNeeded();
  await photoMessage.getByRole("status", { name: "Загрузка фотографии" }).waitFor();
  const preview = photoMessage.locator(`img[src*="${photo.id}"]`);
  await preview.evaluate((image) => image.decode());
  assert.equal(await photoMessage.getByRole("status", { name: "Загрузка фотографии" }).count(), 0);
  assert.equal(await photoMessage.locator(".chat-message-bubble > p").count(), 0);
  for (const width of [390, 768, 1440]) {
    await mobile.setViewportSize({ width, height: 844 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false,
      `Photo layout overflows at ${width}px`);
  }
  await mobile.setViewportSize({ width: 390, height: 844 });
  await photoMessage.getByRole("button", { name: "Открыть фото team-photo.png" }).click();
  const photoDialog = mobile.getByRole("dialog", { name: "Фото" });
  await photoDialog.getByAltText("team-photo.png").evaluate((image) => image.decode());
  assert.match(await photoDialog.getByRole("link", { name: "Скачать" }).getAttribute("href"), new RegExp(photo.id));
  const previewResponse = await mobile.request.get(`${baseUrl}/api/v1/chat/attachments/${photo.id}/download?preview=1`);
  assert.equal(previewResponse.status(), 200);
  assert.match(previewResponse.headers()["content-type"], /^image\/webp/);
  await photoDialog.getByRole("button", { name: "Закрыть окно" }).click();
  await mobileContext.close();
  console.log(`Chat delivery passed: message arrived in ${elapsedMs}ms, mobile reply used send button, WebM/MP3 and M4A messages played, off-screen voice unloaded and reloaded on click, a recording preview played from its blob URL, and a photo loaded with preloader, inline preview and original download on 390/768/1440px.`);
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { server.kill("SIGTERM"); await serverExit; }
  if (sql) await sql.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
