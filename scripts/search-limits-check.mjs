import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import postgres from "postgres";

const baseUrl = process.env.SMOKE_BASE_URL;
const databaseUrl = process.env.DATABASE_URL;
const identity = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!baseUrl || !databaseUrl || !identity || !password) throw new Error("Disposable runtime credentials are required.");
if (!/^\/(crm_smoke_[a-f0-9]{32}|crm_ci)$/.test(new URL(databaseUrl).pathname)) {
  throw new Error("Search-limit fixtures may only be changed in the disposable smoke/CI database.");
}
const origin = new URL(baseUrl).origin;
const sql = postgres(databaseUrl, { max: 1 });
const cookies = [];

async function search(cookie, query = "quota", extraHeaders = {}) {
  return fetch(`${origin}/api/v1/search?q=${encodeURIComponent(query)}`, {
    headers: { ...(cookie ? { cookie } : {}), ...extraHeaders }, signal: AbortSignal.timeout(15_000),
  });
}

try {
  const members = await sql`SELECT id, organization_id FROM organization_members WHERE email = ${identity}`;
  assert.equal(members.length, 1, "This check requires a unique disposable bootstrap member");
  const member = members[0];
  const budgetRows = () => sql`SELECT member_id, request_count FROM request_rate_limits
    WHERE organization_id = ${member.organization_id} AND operation = 'global_search'`;
  assert.equal((await budgetRows()).length, 0, "Run against a fresh smoke company before other search scenarios");
  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`${origin}/api/v1/auth/login`, {
      method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ identity, password }), signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200);
    cookies.push(response.headers.get("set-cookie").split(";")[0]);
  }
  assert.equal((await search()).status, 401);
  assert.equal((await search(cookies[0], "x")).status, 400);
  await sql`INSERT INTO member_permission_overrides (organization_id, member_id, permission, allowed)
    VALUES (${member.organization_id}, ${member.id}, 'search.use', false)`;
  try { assert.equal((await search(cookies[0])).status, 403); }
  finally {
    await sql`DELETE FROM member_permission_overrides WHERE organization_id = ${member.organization_id}
      AND member_id = ${member.id} AND permission = 'search.use'`;
  }
  assert.equal((await budgetRows()).length, 0, "Invalid/unauthorized/forbidden requests must not consume search budgets");

  await sql`INSERT INTO request_rate_limits (organization_id, member_id, operation, request_count)
    VALUES (${member.organization_id}, ${member.id}, 'global_search', 119)`;
  const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => search(cookies[index % 2], `quota ${index}`, {
    "x-forwarded-for": `192.0.2.${index + 1}`,
  })));
  assert.equal(attempts.filter((response) => response.status === 200).length, 1);
  assert.equal(attempts.filter((response) => response.status === 429).length, 11, "Sessions, queries and spoofed IPs must not bypass the member quota");
  for (const response of attempts) {
    const payload = await response.json();
    if (response.status === 429) {
      assert.equal(payload.error.code, "rate_limited");
      const retryAfter = Number(response.headers.get("retry-after"));
      assert.ok(retryAfter >= 1 && retryAfter <= 60);
      assert.match(response.headers.get("cache-control"), /private.*no-store/);
      assert.match(payload.error.message, /Повторите через \d+ сек/);
      assert.equal(payload.data, undefined, "Rejection must not masquerade as empty search results");
    } else {
      assert.ok(Array.isArray(payload.data.results));
    }
  }
  const rows = await budgetRows();
  assert.equal(rows.find((row) => row.member_id === null).request_count, 1);

  await sql`UPDATE request_rate_limits SET request_count = CASE WHEN member_id IS NULL THEN 1200 ELSE 1 END
    WHERE organization_id = ${member.organization_id} AND operation = 'global_search'`;
  assert.equal((await search(cookies[0])).status, 429, "Company quota must deny an otherwise eligible member");
  await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
    WHERE organization_id = ${member.organization_id} AND operation = 'global_search'`;
  assert.equal((await search(cookies[1])).status, 200, "Search must recover after database budget windows expire");
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const context = await browser.newContext();
    const separator = cookies[0].indexOf("=");
    await context.addCookies([{ name: cookies[0].slice(0, separator), value: cookies[0].slice(separator + 1), url: origin, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mkdir("artifacts/production", { recursive: true });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/clients`);
      await sql`UPDATE request_rate_limits SET request_count = 120, window_started_at = now()
        WHERE organization_id = ${member.organization_id} AND member_id = ${member.id} AND operation = 'global_search'`;
      await page.getByRole("button", { name: "Открыть глобальный поиск", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Глобальный поиск", exact: true });
      const input = dialog.getByRole("combobox");
      const [denied] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/search"),
        input.fill("quota-browser"),
      ]);
      assert.equal(denied.status(), 429);
      await dialog.getByText(/Слишком много поисковых запросов/).waitFor();
      assert.equal(await input.inputValue(), "quota-browser");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `artifacts/production/search-limit-${width}.png`, fullPage: true });
      await sql`UPDATE request_rate_limits SET window_started_at = now() - interval '61 seconds'
        WHERE organization_id = ${member.organization_id} AND operation = 'global_search'`;
      const [recovered] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/v1/search"),
        dialog.getByRole("button", { name: "Повторить", exact: true }).click(),
      ]);
      assert.equal(recovered.status(), 200);
      await dialog.getByText(/Слишком много поисковых запросов/).waitFor({ state: "hidden" });
      assert.equal(await input.inputValue(), "quota-browser");
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  console.log("Search quota checks passed: auth/permission/validation, concurrent shared sessions, forged IPs, company limit, Retry-After, and browser error/recovery at 1440/390 px.");
} finally {
  try {
    for (const cookie of cookies) {
      const response = await fetch(`${origin}/api/v1/auth/logout`, {
        method: "POST", headers: { origin, cookie }, signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
    }
  } finally { await sql.end(); }
}
