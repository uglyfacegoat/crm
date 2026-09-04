import assert from "node:assert/strict";
import test from "node:test";
import { parseDigitStyle, parseFontScale } from "./appearance.ts";

test("appearance preferences accept only known values", () => {
  assert.equal(parseFontScale("large"), "large");
  assert.equal(parseFontScale("unexpected"), "standard");
  assert.equal(parseDigitStyle("tabular"), "tabular");
  assert.equal(parseDigitStyle(undefined), "proportional");
});
