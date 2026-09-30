import assert from "node:assert/strict";
import test from "node:test";
import { completeVisitSchema, createVisitSeriesSchema, rescheduleVisitSchema, startVisitSchema, updateVisitSchema } from "./schemas.ts";

test("visit series accepts hand-picked dates and rejects duplicates", () => {
  const input = { idempotencyKey: "a9ca47eb-486d-4e5c-9fbc-c82e16616457",
    orderId: "69166619-057f-459d-861d-4fbcb4a144ab", scheduleMode: "dates",
    selectedDates: ["2026-10-12", "2026-10-19"], startsOn: "2026-10-12", endsOn: "2026-10-19",
    localTime: "10:00", durationMinutes: 120, frequencyUnit: "month", frequencyInterval: 1,
    assignedMasterId: "", notes: "" };
  assert.equal(createVisitSeriesSchema.safeParse(input).success, true);
  assert.equal(createVisitSeriesSchema.safeParse({ ...input, selectedDates: ["2026-10-12", "2026-10-12"] }).success, false);
  assert.equal(createVisitSeriesSchema.safeParse({ ...input, selectedDates: ["2026-10-20"] }).success, false);
});

test("visit rescheduling accepts a versioned 15-minute schedule target", () => {
  const input = { visitId: "69166619-057f-459d-861d-4fbcb4a144ab", expectedVersion: 3, localDate: "2026-08-31", localTime: "13:15", rescheduleReason: "Клиент попросил изменить время" };
  assert.equal(rescheduleVisitSchema.safeParse(input).success, true);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, localTime: "25:00" }).success, false);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, rescheduleReason: "" }).success, false);
  assert.equal(rescheduleVisitSchema.safeParse({ ...input, rescheduleReason: "  а  " }).success, false);
});

test("visit completion requires a version, act title and meaningful result", () => {
  const input = {
    idempotencyKey: "a9ca47eb-486d-4e5c-9fbc-c82e16616457",
    visitId: "69166619-057f-459d-861d-4fbcb4a144ab",
    expectedVersion: 3,
    actTitle: "Акт выполненных работ №1248",
    completionNotes: "Обработка выполнена, следов активности после осмотра нет.",
  };
  assert.equal(completeVisitSchema.safeParse(input).success, true);
  assert.equal(completeVisitSchema.safeParse({ ...input, completionNotes: "  " }).success, false);
  assert.equal(completeVisitSchema.safeParse({ ...input, actTitle: "A" }).success, false);
});

test("generic visit update cannot bypass the closing document flow", () => {
  const result = updateVisitSchema.safeParse({
    visitId: "69166619-057f-459d-861d-4fbcb4a144ab",
    expectedVersion: 3,
    localDate: "2026-08-31",
    localTime: "13:15",
    durationMinutes: 120,
    status: "completed",
    assignedMasterId: "",
    cancellationReason: "",
    notes: "",
  });
  assert.equal(result.success, false);
});

test("starting an assigned visit requires optimistic concurrency", () => {
  const input = { visitId: "69166619-057f-459d-861d-4fbcb4a144ab", expectedVersion: 3 };
  assert.equal(startVisitSchema.safeParse(input).success, true);
  assert.equal(startVisitSchema.safeParse({ ...input, expectedVersion: 0 }).success, false);
  assert.equal(startVisitSchema.safeParse({ ...input, visitId: "not-a-uuid" }).success, false);
});
