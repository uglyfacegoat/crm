import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateServiceLineTotalMinor,
  formatQuantityForDatabase,
  minorUnitsToSafeNumber,
  parseMoneyToMinorUnits,
  parseQuantityToMilliunits,
} from "./money.ts";

test("money is parsed into integer minor units", () => {
  assert.equal(parseMoneyToMinorUnits("12 345"), 1_234_500n);
  assert.equal(parseMoneyToMinorUnits("125.7"), 12_570n);
  assert.equal(parseMoneyToMinorUnits("0,05"), 5n);
});

test("quantity supports three decimal places and excludes zero", () => {
  assert.equal(parseQuantityToMilliunits("1"), 1_000n);
  assert.equal(parseQuantityToMilliunits("2,125"), 2_125n);
  assert.equal(formatQuantityForDatabase(2_125n), "2.125");
  assert.throws(() => parseQuantityToMilliunits("0"), RangeError);
  assert.throws(() => parseQuantityToMilliunits("1.0001"), RangeError);
});

test("service total is rounded to the nearest kopeck", () => {
  assert.equal(calculateServiceLineTotalMinor(10_001n, 1_500n), 15_002n);
  assert.equal(calculateServiceLineTotalMinor(1n, 500n), 1n);
});

test("invalid monetary values fail instead of being coerced", () => {
  assert.throws(() => parseMoneyToMinorUnits("-1"), RangeError);
  assert.throws(() => parseMoneyToMinorUnits("10.001"), RangeError);
  assert.throws(() => parseMoneyToMinorUnits(""), RangeError);
  assert.throws(() => minorUnitsToSafeNumber("9007199254740992"), RangeError);
});
