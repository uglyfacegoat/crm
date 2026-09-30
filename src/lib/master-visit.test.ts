import assert from "node:assert/strict";
import { test } from "node:test";
import { masterVisitHref } from "./master-visit.ts";

const visit = { id: "visit", orderId: null, orderNumber: null, clientName: "Клиент", objectAddress: "Адрес",
  scheduledStartAt: "2030-01-01T23:30:00Z", timezone: "Europe/Moscow" };

test("master's contract-only route opens its local calendar day without a broken order URL", () => {
  const params = new URL(masterVisitHref(visit), "https://crm.example.test");
  assert.equal(params.pathname, "/calendar");
  assert.equal(params.searchParams.get("date"), "2030-01-02");
  assert.equal(params.searchParams.get("view"), "list");
  assert.equal(params.searchParams.has("contract"), false);
});
test("master's order route opens the order directly and preserves the company's context", () => {
  assert.equal(masterVisitHref({ ...visit, orderId: "existing-order" }), "/orders/existing-order");
  const params = new URL(masterVisitHref({ ...visit, timezone: "America/Los_Angeles" }), "https://crm.example.test");
  assert.equal(params.searchParams.get("date"), "2030-01-01");
});
