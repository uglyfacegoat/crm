import assert from "node:assert/strict";
import test from "node:test";
import { copyOrderSchema } from "./schemas.ts";

const sourceOrderId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const expenseId = "33333333-3333-4333-8333-333333333333";
const visitId = "44444444-4444-4444-8444-444444444444";

test("copyOrderSchema accepts an explicit copy selection", () => {
  const result = copyOrderSchema.safeParse({
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    sourceOrderId,
    expectedVersion: 3,
    copyDate: "2026-09-01",
    serviceIds: [serviceId],
    expenseIds: [expenseId],
    visitIds: [visitId],
    copyMaster: true,
    copyNotes: false,
  });
  assert.equal(result.success, true);
});

test("copyOrderSchema requires at least one service", () => {
  const result = copyOrderSchema.safeParse({
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    sourceOrderId,
    expectedVersion: 3,
    copyDate: "2026-09-01",
    serviceIds: [],
    expenseIds: [],
    visitIds: [],
    copyMaster: false,
    copyNotes: true,
  });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.flatten().fieldErrors.serviceIds?.[0], "Выберите хотя бы одну услугу");
});

test("copyOrderSchema rejects duplicated selections", () => {
  const result = copyOrderSchema.safeParse({
    idempotencyKey: "55555555-5555-4555-8555-555555555555",
    sourceOrderId,
    expectedVersion: 3,
    copyDate: "2026-09-01",
    serviceIds: [serviceId, serviceId],
    expenseIds: [],
    visitIds: [],
    copyMaster: false,
    copyNotes: true,
  });
  assert.equal(result.success, false);
});
