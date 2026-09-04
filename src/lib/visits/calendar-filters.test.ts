import assert from "node:assert/strict";
import test from "node:test";
import { filterCalendarVisits, type CalendarVisitFilters } from "./calendar-filters.ts";
import type { ServiceVisit } from "../../server/visits/types.ts";

const baseFilters: CalendarVisitFilters = {
  query: "",
  master: "all",
  region: "all",
  client: "all",
  object: "all",
  status: "all",
  service: "all",
};

function visit(overrides: Partial<ServiceVisit>): ServiceVisit {
  return {
    id: "visit-1",
    seriesId: null,
    occurrenceNumber: null,
    orderId: "order-1",
    orderNumber: "№1001",
    client: "ТехСтройИнвест",
    object: "Главный офис",
    address: "Москва, Тверская, 1",
    scheduledStartAt: "2026-09-04T07:00:00.000Z",
    scheduledEndAt: "2026-09-04T09:00:00.000Z",
    timezone: "Europe/Moscow",
    statusCode: "planned",
    status: "Запланирован",
    copyable: true,
    assignedMasterId: "master-1",
    master: "Алексей Петров",
    masterPhone: "+7 999 111-22-33",
    masterRegion: "Москва",
    serviceSummary: "Дезинсекция, Дератизация",
    cancellationReason: null,
    notes: null,
    completionNotes: null,
    completionDocumentId: null,
    completionDocumentTitle: null,
    completedAt: null,
    version: 1,
    ...overrides,
  };
}

test("calendar search checks order, client, object, address, master, region, and service", () => {
  const source = visit({});
  for (const query of ["1001", "техстрой", "главный", "тверская", "петров", "москва", "дератизация"]) {
    assert.deepEqual(filterCalendarVisits([source], { ...baseFilters, query }), [source]);
  }
  assert.deepEqual(filterCalendarVisits([source], { ...baseFilters, query: "не существует" }), []);
});

test("calendar filters compose with AND semantics", () => {
  const matching = visit({});
  const wrongStatus = visit({ id: "visit-2", statusCode: "completed", status: "Завершён" });
  const wrongService = visit({ id: "visit-3", serviceSummary: "Фумигация" });
  const filters: CalendarVisitFilters = {
    query: "тверская",
    master: "Алексей Петров",
    region: "Москва",
    client: "ТехСтройИнвест",
    object: "Главный офис",
    status: "planned",
    service: "Дезинсекция",
  };

  assert.deepEqual(filterCalendarVisits([matching, wrongStatus, wrongService], filters), [matching]);
});

test("unassigned master filter excludes assigned visits", () => {
  const unassigned = visit({ id: "visit-2", assignedMasterId: null, master: null, masterPhone: null, masterRegion: null });
  assert.deepEqual(filterCalendarVisits([visit({}), unassigned], { ...baseFilters, master: "unassigned" }), [unassigned]);
});
