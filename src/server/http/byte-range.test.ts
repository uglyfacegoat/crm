import assert from "node:assert/strict";
import { test } from "node:test";
import { selectByteRange } from "./byte-range.ts";

test("byte ranges support exact, open-ended, suffix and oversized endpoints", () => {
  for (const [header, start, end] of [["bytes=0-0", 0, 0], ["bytes=2-5", 2, 5], ["bytes=3-", 3, 9], ["bytes=-3", 7, 9], ["bytes=-999999999999999999999", 0, 9], ["bytes=2-999999999999999999999", 2, 9]] as const) {
    assert.deepEqual(selectByteRange(header, 10), { kind: "partial", start, end });
  }
});
test("unsatisfiable and invalid byte ranges do not silently return unrelated bytes", () => {
  for (const header of ["bytes=10-", "bytes=99999999999999999999-", "bytes=-0", "bytes=5-2", "bytes=-", "bytes=hello", "bytes=0-1e3"]) {
    assert.deepEqual(selectByteRange(header, 10), { kind: "unsatisfiable" });
  }
  assert.deepEqual(selectByteRange("bytes=0-", 0), { kind: "unsatisfiable" });
  assert.throws(() => selectByteRange(null, -1), RangeError);
});
test("absent, unknown-unit and unsupported multipart ranges use the full representation", () => {
  for (const header of [null, "items=1-2", "bytes=0-1,5-6"]) assert.deepEqual(selectByteRange(header, 10), { kind: "full" });
});
