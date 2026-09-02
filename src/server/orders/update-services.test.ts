import assert from "node:assert/strict";
import test from "node:test";
import { updateOrderSchema } from "./schemas.ts";

const baseInput = {
  orderId: "11111111-1111-4111-8111-111111111111",
  expectedVersion: 2,
  status: "in_progress",
  statusReason: "",
  assignedMasterId: "",
  masterPayment: "",
  notes: "Уточнённый состав",
};

test("order update accepts a complete editable service composition", () => {
  const result = updateOrderSchema.safeParse({
    ...baseInput,
    services: [{ name: "Дератизация", quantity: "2.5", unitPrice: "12500.50", note: "Два корпуса" }],
  });
  assert.equal(result.success, true);
});

test("order update rejects an empty service composition", () => {
  const result = updateOrderSchema.safeParse({ ...baseInput, services: [] });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.flatten().fieldErrors.services?.[0], "Добавьте хотя бы одну услугу");
});
