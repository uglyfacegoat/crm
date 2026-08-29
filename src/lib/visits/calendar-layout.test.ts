import assert from "node:assert/strict";
import test from "node:test";
import { layoutCalendarIntervals } from "./calendar-layout.ts";

test("overlapping visits receive separate lanes", () => {
  const layout = layoutCalendarIntervals([
    { id: "a", startMinute: 600, endMinute: 720 },
    { id: "b", startMinute: 660, endMinute: 750 },
    { id: "c", startMinute: 690, endMinute: 780 },
  ]);
  assert.deepEqual(layout.map(({ id, lane, laneCount }) => ({ id, lane, laneCount })), [
    { id: "a", lane: 0, laneCount: 3 },
    { id: "b", lane: 1, laneCount: 3 },
    { id: "c", lane: 2, laneCount: 3 },
  ]);
});

test("touching visits reuse a lane and independent clusters recover full width", () => {
  const layout = layoutCalendarIntervals([
    { id: "a", startMinute: 540, endMinute: 600 },
    { id: "b", startMinute: 600, endMinute: 660 },
    { id: "c", startMinute: 700, endMinute: 760 },
    { id: "d", startMinute: 720, endMinute: 780 },
  ]);
  assert.deepEqual(layout.map(({ id, lane, laneCount }) => ({ id, lane, laneCount })), [
    { id: "a", lane: 0, laneCount: 1 },
    { id: "b", lane: 0, laneCount: 1 },
    { id: "c", lane: 0, laneCount: 2 },
    { id: "d", lane: 1, laneCount: 2 },
  ]);
});
