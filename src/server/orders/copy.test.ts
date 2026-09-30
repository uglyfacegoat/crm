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

test("copyOrderSchema permits copying without services to fill them later", () => {
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
  assert.equal(result.success, true);
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

test("copyOrderSchema accepts selected dates for an order series and rejects duplicates", () => {
  const base = { idempotencyKey: "55555555-5555-4555-8555-555555555555", sourceOrderId,
    expectedVersion: 3, copyDate: "2026-10-12", copyDates: ["2026-10-12", "2026-10-19"],
    serviceIds: [serviceId], expenseIds: [], visitIds: [], copyMaster: false, copyNotes: true };
  assert.equal(copyOrderSchema.safeParse(base).success, true);
  assert.equal(copyOrderSchema.safeParse({ ...base, copyDates: ["2026-10-12", "2026-10-12"] }).success, false);
  assert.equal(copyOrderSchema.safeParse({ ...base, copyDate: "2026-10-20" }).success, false);
});

test("copyOrderSchema validates per-date changes and visit windows", () => {
  const base = { idempotencyKey: "55555555-5555-4555-8555-555555555555", sourceOrderId,
    expectedVersion: 3, copyDate: "2026-10-12", copyDates: ["2026-10-12", "2026-10-19"],
    serviceIds: [serviceId], expenseIds: [], visitIds: [visitId], copyMaster: false, copyNotes: false };
  const override = { date: "2026-10-19", assignedMasterId: null, serviceIds: [], notes: "Новый пропуск",
    startTime: "09:30", endTime: "11:00", extraServices: [{ name: "Дополнительная обработка", kind: "service", unit: "м²", quantity: 2, unitPrice: 150 }] };
  assert.equal(copyOrderSchema.safeParse({ ...base, dateOverrides: [override] }).success, true);
  assert.equal(copyOrderSchema.safeParse({ ...base, dateOverrides: [{ ...override, endTime: "09:30" }] }).success, false);
  assert.equal(copyOrderSchema.safeParse({ ...base, dateOverrides: [{ ...override, startTime: "23:30", endTime: "01:00" }] }).success, true);
  assert.equal(copyOrderSchema.safeParse({ ...base, dateOverrides: [{ ...override, date: "2026-10-20" }] }).success, false);
  assert.equal(copyOrderSchema.safeParse({ ...base, dateOverrides: [override, override] }).success, false);
});
