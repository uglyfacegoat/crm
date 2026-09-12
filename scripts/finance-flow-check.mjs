import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import postgres from "postgres";

const browserCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]
  : ["/usr/bin/google-chrome", "/usr/bin/chromium"];
const browserPath = process.env.CHROME_PATH ?? browserCandidates.find(existsSync);
const baseUrl = process.env.FINANCE_CHECK_BASE_URL ?? "http://localhost:3000";
const identity = process.env.FINANCE_CHECK_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.FINANCE_CHECK_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;
if (!browserPath) throw new Error("Chrome or Edge was not found. Set CHROME_PATH.");
if (!identity || !password) throw new Error("Finance flow credentials are required.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for finance flow verification.");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
const pageErrors = [];
const consoleErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

async function openDetails(summaryText) {
  const summary = page.locator("summary").filter({ hasText: summaryText }).first();
  await summary.waitFor();
  const details = summary.locator("..");
  if (await details.getAttribute("open") === null) await summary.click();
}

const suffix = String(Date.now()).slice(-7);
const invoiceNumber = `E2E-Ф-${suffix}`;
let invoiceId = null;
let paymentId = null;
let payoutId = null;
let target = null;

try {
  [target] = await sql`SELECT orders.id, orders.order_number, orders.organization_id,
      orders.agreed_total_minor, orders.master_payment_snapshot_minor,
      orders.assigned_master_id AS original_master_id, orders.master_name_snapshot AS original_master_name,
      orders.master_phone_snapshot AS original_master_phone, masters.id AS test_master_id,
      masters.full_name AS test_master_name, masters.phone AS test_master_phone,
      (now() AT TIME ZONE organizations.timezone)::date::text AS today,
      ((now() AT TIME ZONE organizations.timezone)::date + 7)::text AS due_on
    FROM orders JOIN organizations ON organizations.id = orders.organization_id
    JOIN LATERAL (SELECT id, full_name, phone FROM masters WHERE masters.organization_id = orders.organization_id ORDER BY masters.created_at LIMIT 1) masters ON true
    WHERE orders.status <> 'cancelled' AND orders.agreed_total_minor >= 20000
      AND NOT EXISTS (SELECT 1 FROM order_invoices WHERE order_invoices.organization_id = orders.organization_id AND order_invoices.order_id = orders.id)
    ORDER BY orders.created_at DESC LIMIT 1`;
  if (!target) throw new Error("Finance flow requires an order, a master and no existing invoices.");
  await sql`UPDATE orders SET assigned_master_id = ${target.test_master_id}, master_name_snapshot = ${target.test_master_name},
      master_phone_snapshot = ${target.test_master_phone}, master_payment_snapshot_minor = 50000
    WHERE id = ${target.id}`;

  await page.goto(`${baseUrl}/finance`, { waitUntil: "networkidle" });
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("Email или телефон").fill(identity);
    await page.getByPlaceholder("Пароль").fill(password);
    await page.getByRole("button", { name: "Войти в CRM" }).click();
    await page.waitForURL(`${baseUrl}/finance`);
  }
  await page.getByRole("heading", { name: "Финансы", exact: true }).waitFor();
  await page.getByPlaceholder("Заказ, клиент, объект или счёт").fill(target.order_number);
  await page.getByRole("button", { name: "Новый счёт", exact: true }).click();
  const invoiceDialog = page.getByRole("dialog", { name: "Новый счёт" });
  await invoiceDialog.locator('input[name="invoiceNumber"]').fill(invoiceNumber);
  await invoiceDialog.locator('input[name="amount"]').fill("200");
  await invoiceDialog.locator('input[name="issuedOn"]').fill(target.today);
  await invoiceDialog.locator('input[name="dueOn"]').fill(target.due_on);
  await invoiceDialog.getByRole("button", { name: "Выставить счёт" }).click();
  await invoiceDialog.waitFor({ state: "hidden" });

  await openDetails("Счета и оплаты");
  await page.getByRole("button", { name: "Добавить оплату", exact: true }).click();
  const paymentDialog = page.getByRole("dialog", { name: "Оплата клиента" });
  await paymentDialog.locator('input[name="amount"]').fill("125");
  await paymentDialog.locator('input[name="receivedOn"]').fill(target.today);
  await paymentDialog.locator('input[name="reference"]').fill(`ПП-${suffix}`);
  await paymentDialog.getByRole("button", { name: "Провести оплату" }).click();
  await paymentDialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Мастера", exact: true }).click();
  await page.getByRole("button", { name: "Провести выплату", exact: true }).click();
  const payoutDialog = page.getByRole("dialog", { name: "Выплата мастеру" });
  await payoutDialog.locator('input[name="amount"]').fill("100");
  await payoutDialog.locator('input[name="paidOn"]').fill(target.today);
  await payoutDialog.locator('input[name="reference"]').fill(`ВЕД-${suffix}`);
  await payoutDialog.getByRole("button", { name: "Провести выплату" }).click();
  await payoutDialog.waitFor({ state: "hidden" });

  const [invoiceRow] = await sql`SELECT id FROM order_invoices WHERE organization_id = ${target.organization_id} AND invoice_number = ${invoiceNumber}`;
  invoiceId = invoiceRow?.id ?? null;
  if (!invoiceId) throw new Error("Invoice was not persisted.");
  const [paymentRow] = await sql`SELECT id FROM order_payments WHERE organization_id = ${target.organization_id} AND invoice_id = ${invoiceId} AND reference = ${`ПП-${suffix}`}`;
  const [payoutRow] = await sql`SELECT id FROM order_master_payouts WHERE organization_id = ${target.organization_id} AND order_id = ${target.id} AND reference = ${`ВЕД-${suffix}`}`;
  paymentId = paymentRow?.id ?? null;
  payoutId = payoutRow?.id ?? null;
  const [posted] = await sql`SELECT invoiced_total_minor::text, paid_total_minor::text, master_paid_total_minor::text FROM orders WHERE id = ${target.id}`;
  if (!paymentId || !payoutId || posted.invoiced_total_minor !== "20000" || posted.paid_total_minor !== "12500" || posted.master_paid_total_minor !== "10000") {
    throw new Error(`Financial projections are inconsistent: ${JSON.stringify({ invoiceId, paymentId, payoutId, posted })}`);
  }

  await page.getByRole("button", { name: `Сторнировать выплату`, exact: false }).click();
  const payoutReverseDialog = page.getByRole("dialog", { name: "Сторно операции" });
  await payoutReverseDialog.locator('textarea[name="reason"]').fill("Автоматическая проверка сторно выплаты");
  await payoutReverseDialog.getByRole("button", { name: "Сторнировать" }).click();
  await payoutReverseDialog.waitFor({ state: "hidden" });

  await page.getByRole("button", { name: "Дебиторка", exact: true }).click();
  await openDetails("Счета и оплаты");
  await openDetails("История оплат");
  await page.getByRole("button", { name: "Сторно", exact: true }).click();
  const paymentReverseDialog = page.getByRole("dialog", { name: "Сторно операции" });
  await paymentReverseDialog.locator('textarea[name="reason"]').fill("Автоматическая проверка сторно оплаты");
  await paymentReverseDialog.getByRole("button", { name: "Сторнировать" }).click();
  await paymentReverseDialog.waitFor({ state: "hidden" });

  await openDetails("Счета и оплаты");
  await page.getByRole("button", { name: `Аннулировать счёт ${invoiceNumber}` }).click();
  const voidDialog = page.getByRole("dialog", { name: "Аннулировать счёт" });
  await voidDialog.locator('textarea[name="reason"]').fill("Автоматическая проверка аннулирования");
  await voidDialog.getByRole("button", { name: "Аннулировать счёт" }).click();
  await voidDialog.waitFor({ state: "hidden" });

  const [reversed] = await sql`SELECT invoiced_total_minor::text, paid_total_minor::text, master_paid_total_minor::text FROM orders WHERE id = ${target.id}`;
  if (reversed.invoiced_total_minor !== "0" || reversed.paid_total_minor !== "0" || reversed.master_paid_total_minor !== "0") {
    throw new Error(`Financial reversals did not refresh projections: ${JSON.stringify(reversed)}`);
  }
  await page.setViewportSize({ width: 3840, height: 2160 });
  const wide = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (wide.document > wide.viewport) throw new Error(`Finance page overflows 4K viewport: ${JSON.stringify(wide)}`);
  await page.setViewportSize({ width: 320, height: 568 });
  const mobile = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (mobile.document > mobile.viewport) throw new Error(`Finance page overflows mobile viewport: ${JSON.stringify(mobile)}`);
  if (pageErrors.length || consoleErrors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors }));
  process.stdout.write(`${JSON.stringify({ orderId: target.id, invoiceId, paymentId, payoutId, posted, reversed })}\n`);
} finally {
  await browser.close();
  try {
    if (invoiceId || paymentId || payoutId) {
      await sql.begin(async (transaction) => {
        const entityIds = [invoiceId, paymentId, payoutId].filter(Boolean);
        await transaction`DELETE FROM audit_events WHERE organization_id = (SELECT organization_id FROM order_invoices WHERE id = ${invoiceId}) AND entity_id = ANY(${entityIds}::uuid[])`;
        await transaction`DELETE FROM idempotency_requests WHERE entity_id = ANY(${entityIds}::uuid[])`;
        if (payoutId) await transaction`DELETE FROM order_master_payouts WHERE id = ${payoutId}`;
        if (paymentId) await transaction`DELETE FROM order_payments WHERE id = ${paymentId}`;
        if (invoiceId) await transaction`DELETE FROM order_invoices WHERE id = ${invoiceId}`;
      });
    }
  } finally {
    if (target) {
      await sql`UPDATE orders SET assigned_master_id = ${target.original_master_id}, master_name_snapshot = ${target.original_master_name},
          master_phone_snapshot = ${target.original_master_phone}, master_payment_snapshot_minor = ${target.master_payment_snapshot_minor}
        WHERE id = ${target.id}`;
    }
    await sql.end();
  }
}
