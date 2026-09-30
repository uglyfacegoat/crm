import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import postgres from "postgres";

const { SMOKE_BASE_URL: baseUrl, DATABASE_URL: databaseUrl, AUTH_BOOTSTRAP_ADMIN_EMAIL: identity,
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: password, DOCUMENT_STORAGE_ROOT: storageRoot } = process.env;
if (!baseUrl || !databaseUrl || !identity || !password || !storageRoot) throw new Error("Disposable runtime credentials and storage are required.");
if (!/^\/(crm_smoke_[a-f0-9]{32}|crm_ci)$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("Download fixtures may only be changed in the disposable smoke/CI database.");
}

function audioFixture() {
  const sampleRate = 22050;
  const samples = sampleRate * 12;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 1200), 44 + index * 2);
  return buffer;
}

const sql = postgres(databaseUrl, { max: 1 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
try {
  const context = await browser.newContext({ permissions: ["microphone"] });
  const origin = new URL(baseUrl).origin;
  assert.equal((await context.request.post(`${origin}/api/v1/auth/login`, { headers: { origin }, data: { identity, password } })).status(), 200);
  const [member] = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${identity}`;
  assert.ok(member);
  const expire = () => sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation IN ('chat_message', 'chat_upload', 'chat_download')`;
  await expire();
  const page = await context.newPage();
  const browserErrors = [];
  const mediaResponses = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/attachments/") && response.request().headers().range) mediaResponses.push(response.status());
  });
  await page.goto(`${origin}/chat`, { waitUntil: "domcontentloaded" });
  const composer = page.locator("form").filter({ has: page.locator('input[name="channelId"]') });
  const channelId = await composer.locator('input[name="channelId"]').inputValue();
  const messageId = await composer.locator('input[name="idempotencyKey"]').inputValue();
  const audio = audioFixture();
  await composer.locator('textarea[name="body"]').fill("Audio download acceptance fixture");
  await composer.locator('input[name="file"]').setInputFiles({ name: "acceptance.wav", mimeType: "audio/wav", buffer: audio });
  await composer.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea[name="body"]')?.value === "");
  const [attachment] = await sql`SELECT id, storage_key, sha256, size_bytes FROM chat_message_attachments WHERE message_id = ${messageId}`;
  assert.ok(attachment);
  assert.equal(Number(attachment.size_bytes), audio.length);
  assert.equal(attachment.sha256, createHash("sha256").update(audio).digest("hex"));
  const url = `${origin}/api/v1/chat/attachments/${attachment.id}/download`;
  const player = page.locator("[data-voice-player]").filter({ has: page.locator(`audio[src*="${attachment.id}"]`) });
  await mkdir("artifacts/production", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await player.waitFor();
    await page.waitForFunction((id) => {
      const audio = document.querySelector(`audio[src*="${id}"]`);
      return audio?.readyState >= 1 && Math.abs(audio.duration - 12) < 0.05;
    }, attachment.id);
    await player.getByRole("button", { name: "Воспроизвести голосовое", exact: true }).click();
    await page.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`).currentTime > 0.1, attachment.id);
    await player.getByRole("button", { name: "Поставить голосовое на паузу", exact: true }).click();
    const seek = player.getByRole("button", { name: "Перемотать голосовое сообщение", exact: true });
    const bounds = await seek.boundingBox();
    assert.ok(bounds);
    await seek.click({ position: { x: bounds.width * 0.75, y: bounds.height / 2 } });
    await page.waitForFunction((id) => Math.abs(document.querySelector(`audio[src*="${id}"]`).currentTime - 9) < 0.2, attachment.id);
    await player.getByRole("button", { name: "Воспроизвести голосовое", exact: true }).click();
    await page.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`).currentTime > 9.2, attachment.id);
    await player.getByRole("button", { name: "Поставить голосовое на паузу", exact: true }).click();
    assert.equal(await player.getByRole("alert").count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `artifacts/production/chat-audio-download-${width}.png`, fullPage: true });
  }
  assert.ok(mediaResponses.includes(206), "Browser audio must receive a ranged response");
  const voiceMessageId = await composer.locator('input[name="idempotencyKey"]').inputValue();
  await composer.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("form .tabular-nums")?.textContent === "00:01");
  await composer.getByRole("button", { name: "Поставить запись на паузу", exact: true }).click();
  const pausedTime = await composer.locator(".tabular-nums").innerText();
  await page.waitForTimeout(1100);
  assert.equal(await composer.locator(".tabular-nums").innerText(), pausedTime);
  await composer.getByRole("button", { name: "Продолжить запись", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("form .tabular-nums")?.textContent === "00:03");
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function () {
      File.prototype.arrayBuffer = original;
      window.__voiceLegacyFixture = Array.from(new Uint8Array(await original.call(this)));
      throw new Error("Injected one-shot draft read failure");
    };
  });
  await composer.getByRole("button", { name: "Завершить запись", exact: true }).click();
  await composer.getByRole("alert").filter({ hasText: "Запись сохранена в черновике" }).waitFor();
  assert.equal(await composer.getByRole("button", { name: "Отправить голосовое сообщение", exact: true }).count(), 0);
  await composer.getByRole("button", { name: "Повторить подготовку", exact: true }).click();
  await composer.getByRole("button", { name: "Отправить голосовое сообщение", exact: true }).waitFor();
  await page.waitForFunction(() => {
    const audio = document.querySelector("form audio");
    return audio?.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration >= 2 && audio.duration < 4;
  });
  const legacyVoiceBytes = Buffer.from(await page.evaluate(() => window.__voiceLegacyFixture));
  await composer.getByRole("button", { name: "Отправить голосовое сообщение", exact: true }).click();
  await composer.getByRole("button", { name: "Записать голосовое сообщение", exact: true }).waitFor();
  const [recording] = await sql`SELECT id FROM chat_message_attachments WHERE message_id = ${voiceMessageId}`;
  assert.ok(recording);
  await page.reload({ waitUntil: "domcontentloaded" });
  const recordedPlayer = page.locator("[data-voice-player]").filter({ has: page.locator(`audio[src*="${recording.id}"]`) });
  await page.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`)?.readyState >= 1, recording.id);
  const recordingDuration = await recordedPlayer.locator("audio").evaluate((element) => element.duration);
  assert.ok(Number.isFinite(recordingDuration) && recordingDuration >= 2 && recordingDuration < 10,
    `Recorded voice must have a usable duration after upload; received ${recordingDuration}`);
  const recordingSeek = recordedPlayer.getByRole("button", { name: "Перемотать голосовое сообщение", exact: true });
  const recordingBounds = await recordingSeek.boundingBox();
  assert.ok(recordingBounds);
  await recordingSeek.click({ position: { x: recordingBounds.width / 2, y: recordingBounds.height / 2 } });
  await page.waitForFunction(({ id, duration }) => Math.abs(document.querySelector(`audio[src*="${id}"]`).currentTime - duration / 2) < 0.2, { id: recording.id, duration: recordingDuration });
  await recordedPlayer.getByRole("button", { name: "Воспроизвести голосовое", exact: true }).click();
  await page.waitForFunction(({ id, duration }) => document.querySelector(`audio[src*="${id}"]`).currentTime > duration / 2 + 0.1, { id: recording.id, duration: recordingDuration });
  await recordedPlayer.getByRole("button", { name: "Поставить голосовое на паузу", exact: true }).click();
  const legacyMessageId = await composer.locator('input[name="idempotencyKey"]').inputValue();
  await composer.locator('textarea[name="body"]').fill("Legacy voice without duration metadata");
  await composer.locator('input[name="file"]').setInputFiles({ name: "legacy.webm", mimeType: "audio/webm", buffer: legacyVoiceBytes });
  await composer.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('textarea[name="body"]')?.value === "");
  const [legacyAttachment] = await sql`SELECT id, sha256 FROM chat_message_attachments WHERE message_id = ${legacyMessageId}`;
  assert.ok(legacyAttachment);
  assert.equal(legacyAttachment.sha256, createHash("sha256").update(legacyVoiceBytes).digest("hex"));
  const legacyPlayer = page.locator("[data-voice-player]").filter({ has: page.locator(`audio[src*="${legacyAttachment.id}"]`) });
  await page.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`)?.readyState >= 1, legacyAttachment.id);
  assert.equal(await legacyPlayer.getByRole("button", { name: "Перемотать голосовое сообщение", exact: true }).isDisabled(), true);
  await legacyPlayer.getByText("—:—", { exact: true }).waitFor();
  await legacyPlayer.getByRole("button", { name: "Воспроизвести голосовое", exact: true }).click();
  await page.waitForFunction((id) => document.querySelector(`audio[src*="${id}"]`).ended, legacyAttachment.id);
  assert.equal(await legacyPlayer.getByRole("button", { name: "Перемотать голосовое сообщение", exact: true }).isEnabled(), true);
  assert.deepEqual(await (await context.request.get(`${origin}/api/v1/chat/attachments/${legacyAttachment.id}/download`)).body(), legacyVoiceBytes);
  assert.deepEqual(browserErrors, []);
  await page.close();

  const full = await context.request.get(url);
  assert.equal(full.status(), 200);
  assert.deepEqual(await full.body(), audio);
  assert.equal(full.headers()["accept-ranges"], "bytes");
  assert.equal(full.headers()["cache-control"], "private, no-store");
  assert.equal(full.headers()["x-content-type-options"], "nosniff");
  const etag = full.headers().etag;
  for (const [range, start, end] of [["bytes=0-43", 0, 43], ["bytes=500-", 500, audio.length - 1], ["bytes=-64", audio.length - 64, audio.length - 1]]) {
    const response = await context.request.get(url, { headers: { range } });
    assert.equal(response.status(), 206);
    assert.equal(response.headers()["content-range"], `bytes ${start}-${end}/${audio.length}`);
    assert.equal(Number(response.headers()["content-length"]), end - start + 1);
    assert.deepEqual(await response.body(), audio.subarray(start, end + 1));
  }
  const auditCount = async () => Number((await sql`SELECT count(*) FROM audit_events WHERE entity_id = ${attachment.id} AND action = 'chat.attachment.downloaded'`)[0].count);
  const budgetCounts = () => sql`SELECT member_id, request_count FROM request_rate_limits WHERE organization_id = ${member.organization_id} AND operation = 'chat_download' ORDER BY member_id NULLS FIRST`;
  const auditBeforeConditions = await auditCount();
  const head = await context.request.head(url, { headers: { range: "bytes=0-4" } });
  assert.equal(head.status(), 200);
  assert.equal(Number(head.headers()["content-length"]), audio.length);
  assert.equal((await head.body()).length, 0);
  const invalid = await context.request.get(url, { headers: { range: `bytes=${audio.length}-` } });
  assert.equal(invalid.status(), 416);
  assert.equal(invalid.headers()["content-range"], `bytes */${audio.length}`);
  assert.equal((await context.request.get(url, { headers: { "if-none-match": `W/${etag}` } })).status(), 304);
  assert.equal((await context.request.get(url, { headers: { "if-match": '"stale"' } })).status(), 412);
  assert.equal(await auditCount(), auditBeforeConditions);
  assert.equal((await context.request.get(url, { headers: { range: "bytes=0-4", "if-range": etag } })).status(), 206);
  for (const headers of [{ range: "bytes=0-4", "if-range": '"stale"' }, { range: "items=0-4" }, { range: "bytes=0-4,8-9" }]) {
    const response = await context.request.get(url, { headers });
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.body(), audio);
  }

  const auditBeforeDenials = await auditCount();
  const budgetBeforeDenials = await budgetCounts();
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(url)).status(), 401);
  await anonymous.close();
  assert.equal((await context.request.get(`${origin}/api/v1/chat/attachments/not-a-uuid/download`)).status(), 404);
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${member.organization_id}, ${member.id}, 'chat.read', false)`;
  try { assert.equal((await context.request.get(url)).status(), 403); }
  finally { await sql`DELETE FROM member_permission_overrides WHERE organization_id = ${member.organization_id} AND member_id = ${member.id} AND permission = 'chat.read'`; }
  const [membership] = await sql`DELETE FROM chat_channel_members WHERE organization_id = ${member.organization_id} AND channel_id = ${channelId} AND member_id = ${member.id} RETURNING *`;
  try { assert.equal((await context.request.get(url)).status(), 404); }
  finally { await sql`INSERT INTO chat_channel_members ${sql(membership)}`; }
  await sql`UPDATE chat_messages SET deleted_at = now() WHERE id = ${messageId}`;
  try { assert.equal((await context.request.get(url)).status(), 404); }
  finally { await sql`UPDATE chat_messages SET deleted_at = NULL WHERE id = ${messageId}`; }
  const [otherCompany] = await sql`INSERT INTO organizations (name, timezone) VALUES ('Download isolation fixture', 'Europe/Moscow') RETURNING id`;
  const [otherMember] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${otherCompany.id}, 'Other administrator', 'other-download@example.invalid', 'admin') RETURNING id`;
  const token = randomBytes(32).toString("hex");
  await sql`INSERT INTO auth_sessions (organization_id, member_id, token_hash, expires_at)
    VALUES (${otherCompany.id}, ${otherMember.id}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '1 hour')`;
  const outsider = await browser.newContext();
  await outsider.addCookies([{ name: "crm_session", value: token, url: origin }]);
  assert.equal((await outsider.request.get(url)).status(), 404);
  await outsider.close();
  assert.equal(await auditCount(), auditBeforeDenials);
  assert.deepEqual(await budgetCounts(), budgetBeforeDenials);

  for (const company of [false, true]) {
    await expire();
    await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
      VALUES (${member.organization_id}, ${company ? null : member.id}, 'chat_download', ${company ? 3000 : 300})
      ON CONFLICT (organization_id, member_id, operation) DO UPDATE SET request_count = EXCLUDED.request_count, window_started_at = now()`;
    const response = await context.request.get(url, { headers: { range: "bytes=0-4" } });
    assert.equal(response.status(), 429);
    assert.ok(Number(response.headers()["retry-after"]) > 0);
    assert.equal(response.headers()["cache-control"], "private, no-store");
  }
  assert.equal(await auditCount(), auditBeforeDenials);
  await expire();
  const path = resolve(join(storageRoot, attachment.storage_key));
  assert.ok(path.startsWith(resolve(storageRoot) + sep));
  assert.deepEqual(await readFile(path), audio);
  const corrupted = Buffer.from(audio);
  corrupted[corrupted.length - 1] ^= 1;
  await writeFile(path, corrupted);
  try {
    const response = await context.request.get(url, { headers: { range: "bytes=0-4" } });
    assert.equal(response.status(), 500);
    assert.deepEqual(await response.json(), { error: "file_integrity_error" });
    assert.equal(await auditCount(), auditBeforeDenials);
  } finally { await writeFile(path, audio); }
  assert.equal((await context.request.get(url)).status(), 200);
  console.log("Download acceptance passed: WAV playback/seek at 1440/390 px, voice recording/pause/resume/preparation failure/retry/upload/reload/seek, range/HEAD/conditions, permission/membership/deletion/company isolation, member/company budgets, corruption outside requested range, recovery.");
} finally {
  await browser.close();
  await sql.end();
}
