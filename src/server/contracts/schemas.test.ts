import assert from "node:assert/strict";
import test from "node:test";
import { createContractSchema, linkContractSchema, renewContractSchema } from "./schemas.ts";

const valid = {
  idempotencyKey: "ed0a2a49-51e4-40a4-9c1c-5207b61cf7c4",
  clientId: "ed0a2a49-51e4-40a4-9c1c-5207b61cf7c5",
  objectId: "ed0a2a49-51e4-40a4-9c1c-5207b61cf7c6",
  contractNumber: "Д-2026/14",
  status: "active",
  startsOn: "2026-09-01",
  endsOn: "2027-08-31",
  renewalNoticeDays: 30,
  notes: "Ежемесячная профилактическая обработка",
  scheduleEnabled: true,
  frequencyUnit: "month",
  frequencyInterval: 1,
  localTime: "10:00",
  durationMinutes: 120,
  defaultMasterId: "",
};

test("accepts an annual contract with a recurring schedule", () => {
  assert.equal(createContractSchema.safeParse(valid).success, true);
});

test("rejects reversed and longer than annual contract periods", () => {
  assert.equal(createContractSchema.safeParse({ ...valid, endsOn: "2026-08-31" }).success, false);
  assert.equal(createContractSchema.safeParse({ ...valid, endsOn: "2028-01-01" }).success, false);
});

test("renewal preserves optimistic concurrency and explicit schedule choice", () => {
  const renewal = { idempotencyKey: valid.idempotencyKey, sourceContractId: valid.clientId, expectedVersion: 2, contractNumber: "Д-2027/14", startsOn: "2027-09-01", endsOn: "2028-08-31", renewalNoticeDays: 30, copySchedule: true };
  assert.equal(renewContractSchema.safeParse(renewal).success, true);
  assert.equal(renewContractSchema.safeParse({ ...renewal, expectedVersion: 0 }).success, false);
});

test("contract relation requires two distinct contracts and a known relation type", () => {
  const relation = {
    contractId: valid.clientId,
    relatedContractId: valid.objectId,
    relationType: "supplement",
    note: "Дополнительные сезонные работы",
  };
  assert.equal(linkContractSchema.safeParse(relation).success, true);
  assert.equal(linkContractSchema.safeParse({ ...relation, relatedContractId: relation.contractId }).success, false);
  assert.equal(linkContractSchema.safeParse({ ...relation, relationType: "duplicate" }).success, false);
});
