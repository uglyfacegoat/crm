import assert from "node:assert/strict";
import test from "node:test";
import { createMasterSchema, updateMasterSchema } from "./schemas.ts";

const validMaster = {
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  fullName: "  Алексей Смирнов  ",
  phone: "+7 (999) 123-45-67",
  messenger: "@alex",
  serviceRegion: "Москва",
  serviceZone: "ЦАО",
  basePaymentMinor: "4 000,50",
  dailyCapacity: "4",
  skills: "Дератизация, Дезинсекция, Дератизация",
  notes: "",
  operationalStatus: "working",
  workingDays: [1, 2, 3, 4, 5],
  statusUntil: "",
  statusNote: "",
};

test("master input normalizes money, text and unique skills", () => {
  const parsed = createMasterSchema.parse(validMaster);
  assert.equal(parsed.fullName, "Алексей Смирнов");
  assert.equal(parsed.basePaymentMinor, 400_050);
  assert.equal(parsed.dailyCapacity, 4);
  assert.deepEqual(parsed.skills, ["Дератизация", "Дезинсекция"]);
  assert.equal(parsed.notes, null);
});

test("master input rejects invalid contacts and capacity", () => {
  const parsed = createMasterSchema.safeParse({ ...validMaster, phone: "123", dailyCapacity: "21" });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.flatten().fieldErrors.phone);
    assert.ok(parsed.error.flatten().fieldErrors.dailyCapacity);
  }
});

test("update input supports terminating a master while preserving the record", () => {
  const parsed = updateMasterSchema.parse({
    ...validMaster,
    masterId: "00000000-0000-4000-8000-000000000002",
    expectedVersion: "3",
    operationalStatus: "terminated",
    statusNote: "Сотрудничество завершено",
    active: false,
  });
  assert.equal(parsed.expectedVersion, 3);
  assert.equal(parsed.active, false);
  assert.equal(parsed.operationalStatus, "terminated");
});

test("temporary and terminal statuses require an explanation", () => {
  const parsed = createMasterSchema.safeParse({ ...validMaster, operationalStatus: "vacation" });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.ok(parsed.error.flatten().fieldErrors.statusNote);
});
