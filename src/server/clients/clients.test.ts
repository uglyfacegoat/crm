import assert from "node:assert/strict";
import test from "node:test";
import { isValidContactPhone, normalizeContactPhone } from "./phone.ts";

test("normalizes Russian and international contact phones", () => {
  assert.equal(normalizeContactPhone("8 (999) 123-45-67"), "+79991234567");
  assert.equal(normalizeContactPhone("999 123 45 67"), "+79991234567");
  assert.equal(normalizeContactPhone("+49 30 123456789"), "+4930123456789");
  assert.equal(isValidContactPhone("123"), false);
});
