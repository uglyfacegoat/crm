import assert from "node:assert/strict";
import test from "node:test";
import { getMasterStatus } from "./status.ts";

test("master availability reflects active state and daily capacity", () => {
  assert.equal(getMasterStatus(false, 0, 4).code, "inactive");
  assert.equal(getMasterStatus(true, 0, 4).code, "available");
  assert.equal(getMasterStatus(true, 4, 4).code, "scheduled");
  assert.equal(getMasterStatus(true, 5, 4).code, "overloaded");
});
