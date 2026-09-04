import test from "node:test";
import assert from "node:assert/strict";
import { rejectIncomingLeadSchema, websiteLeadWebhookSchema } from "./schemas.ts";

test("website lead accepts a traceable request with one contact channel", () => {
  const parsed = websiteLeadWebhookSchema.safeParse({
    websiteId: "c7809f54-88d5-447c-a042-0f53e6791e33",
    eventId: "form:request-104",
    phone: "+7 (999) 123-45-67",
    email: "CLIENT@EXAMPLE.COM",
    landingUrl: "https://example.com/service",
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.email, "client@example.com");
});

test("website lead rejects missing contact data and malformed input", () => {
  assert.equal(websiteLeadWebhookSchema.safeParse({ websiteId: crypto.randomUUID(), eventId: "event-1" }).success, false);
  assert.equal(websiteLeadWebhookSchema.safeParse({ websiteId: crypto.randomUUID(), eventId: "event-2", email: "1111" }).success, false);
});

test("lead rejection is versioned and requires a reason", () => {
  const leadId = crypto.randomUUID();
  assert.equal(rejectIncomingLeadSchema.safeParse({ leadId, expectedVersion: 2, reason: "Дублирующая заявка" }).success, true);
  assert.equal(rejectIncomingLeadSchema.safeParse({ leadId, expectedVersion: 2, reason: "" }).success, false);
});

