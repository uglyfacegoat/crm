import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import postgres from "postgres";

const baseUrl = process.env.SMOKE_BASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
const storageRoot = process.env.DOCUMENT_STORAGE_ROOT;
if (!baseUrl || !databaseUrl || !identity || !password || !storageRoot) throw new Error("Disposable runtime credentials and storage are required.");
if (!/^\/(crm_smoke_[a-f0-9]{32}|crm_ci)$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("Chat-limit fixtures may only be changed in the disposable smoke/CI database.");
}
const sql = postgres(databaseUrl, { max: 1 });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  const context = await browser.newContext();
  const origin = new URL(baseUrl).origin;
  const login = await context.request.post(`${origin}/api/v1/auth/login`, {
    headers: { origin }, data: { identity, password },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/chat`);
  const composer = page.locator("form").filter({ has: page.locator('input[name="channelId"]') });
  await composer.locator('textarea[name="body"]').waitFor();
  const channelId = await composer.locator('input[name="channelId"]').inputValue();
  const members = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${identity}`;
  assert.equal(members.length, 1);
  const member = members[0];
  const text = composer.locator('textarea[name="body"]');
  const file = composer.locator('input[name="file"]');
  const key = composer.locator('input[name="idempotencyKey"]');
  const submit = () => composer.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
  const expire = () => sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation IN ('chat_message', 'chat_upload')`;
  async function exhaust(operation, company = false) {
    await expire();
    const limit = operation === "chat_message" ? (company ? 600 : 60) : (company ? 100 : 10);
    await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
      VALUES (${member.organization_id}, ${company ? null : member.id}, ${operation}, ${limit})
      ON CONFLICT (organization_id, member_id, operation) DO UPDATE
        SET request_count = EXCLUDED.request_count, window_started_at = now()`;
  }
  async function assertPreserved(draft, requestKey) {
    assert.equal(await text.inputValue(), draft);
    assert.equal(await key.inputValue(), requestKey);
    assert.equal(await file.evaluate((input) => input.files[0]?.name), "fixture.pdf");
    assert.equal(await composer.locator("fieldset").isDisabled(), false);
    const messages = await sql`SELECT id FROM chat_messages WHERE id = ${requestKey}`;
    assert.equal(messages.length, 0);
  }
  await mkdir("artifacts/production", { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const operation of ["chat_message", "chat_upload"]) {
      await exhaust(operation, width === 390);
      const draft = `Preserved ${operation} ${width}`;
      await text.fill(draft);
      await file.setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
      const requestKey = await key.inputValue();
      const filesBefore = (await readdir(storageRoot, { recursive: true })).sort();
      await submit();
      await composer.getByRole("alert").filter({ hasText: /Слишком много/ }).waitFor();
      await assertPreserved(draft, requestKey);
      assert.deepEqual((await readdir(storageRoot, { recursive: true })).sort(), filesBefore, "Denied uploads must not create storage files");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `artifacts/production/chat-${operation}-${width}.png`, fullPage: true });
      await expire();
      await submit();
      await page.waitForFunction(() => document.querySelector('textarea[name="body"]')?.value === "");
      assert.notEqual(await key.inputValue(), requestKey);
      assert.equal(await file.evaluate((input) => input.files.length), 0);
      const rows = await sql`SELECT messages.body, attachments.original_filename FROM chat_messages messages
        JOIN chat_message_attachments attachments ON attachments.message_id = messages.id
        WHERE messages.id = ${requestKey} AND messages.organization_id = ${member.organization_id}`;
      assert.deepEqual(rows.map((row) => ({ ...row })), [{ body: draft, original_filename: "fixture.pdf" }]);
    }
  }

  const requestKey = await key.inputValue();
  const draft = "Keep this draft when another message arrives";
  await text.fill(draft);
  await file.setInputFiles({ name: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  const [peer] = await sql`INSERT INTO organization_members (organization_id, display_name, email, role)
    VALUES (${member.organization_id}, 'Chat test peer', 'chat-peer@example.invalid', 'dispatcher') RETURNING id`;
  await sql`INSERT INTO chat_channel_members (organization_id, channel_id, member_id, channel_role, joined_by)
    VALUES (${member.organization_id}, ${channelId}, ${peer.id}, 'member', ${member.id})`;
  const incoming = `Incoming fixture ${randomUUID()}`;
  await sql`INSERT INTO chat_messages (id, organization_id, channel_id, author_id, body)
    VALUES (${randomUUID()}, ${member.organization_id}, ${channelId}, ${peer.id}, ${incoming})`;
  await page.getByRole("button", { name: "Обновить сообщения", exact: true }).click();
  await page.getByText(incoming, { exact: true }).waitFor();
  await assertPreserved(draft, requestKey);

  const budgetsBefore = await sql`SELECT operation, member_id, request_count FROM request_rate_limits
    WHERE organization_id = ${member.organization_id} ORDER BY operation, member_id NULLS FIRST`;
  const filesBefore = (await readdir(storageRoot, { recursive: true })).sort();
  await composer.locator('input[name="channelId"]').evaluate((input) => { input.value = crypto.randomUUID(); });
  await submit();
  await composer.getByRole("alert").filter({ hasText: /недоступна/ }).waitFor();
  await assertPreserved(draft, requestKey);
  assert.deepEqual((await readdir(storageRoot, { recursive: true })).sort(), filesBefore);
  assert.deepEqual(await sql`SELECT operation, member_id, request_count FROM request_rate_limits
    WHERE organization_id = ${member.organization_id} ORDER BY operation, member_id NULLS FIRST`, budgetsBefore);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(errors, []);
  console.log("Chat checks passed: member/company message and upload limits, no denied file writes, draft/file/key preservation, successful retries, incoming-message refresh, forged channel, 1440/390 px.");
} finally {
  await browser.close();
  await sql.end();
}
