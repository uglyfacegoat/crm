import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentTemplateSchema, updateDocumentTemplateStatusSchema } from "./schemas.ts";

test("act template metadata does not accept arbitrary legal template kinds", () => {
  const valid = createDocumentTemplateSchema.safeParse({ idempotencyKey: crypto.randomUUID(), title: "Акт дезинсекции", description: "Утверждённая форма", kind: "closing_act" });
  const invalid = createDocumentTemplateSchema.safeParse({ idempotencyKey: crypto.randomUUID(), title: "Договор", description: "", kind: "contract" });
  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test("template status update requires optimistic version", () => {
  assert.equal(updateDocumentTemplateStatusSchema.safeParse({ templateId: crypto.randomUUID(), expectedVersion: 2, active: false }).success, true);
  assert.equal(updateDocumentTemplateStatusSchema.safeParse({ templateId: crypto.randomUUID(), expectedVersion: 0, active: false }).success, false);
});
