import assert from "node:assert/strict";
import test from "node:test";
import { getMasterStatus } from "./status.ts";

test("master availability reflects active state and daily capacity", () => {
  assert.equal(getMasterStatus("terminated", 0, 4).code, "terminated");
  assert.equal(getMasterStatus("vacation", 0, 4).code, "vacation");
  assert.equal(getMasterStatus("unavailable", 0, 4).code, "unavailable");
  assert.equal(getMasterStatus("working", 0, 4).code, "available");
  assert.equal(getMasterStatus("working", 4, 4).code, "scheduled");
  assert.equal(getMasterStatus("working", 5, 4).code, "overloaded");
});
