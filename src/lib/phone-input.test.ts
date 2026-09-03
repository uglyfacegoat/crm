import assert from "node:assert/strict";
import test from "node:test";
import { formatPhoneInput } from "./phone-input.ts";

test("formatPhoneInput formats Russian numbers while typing", () => {
  assert.equal(formatPhoneInput("89991234567"), "+7 (999) 123-45-67");
  assert.equal(formatPhoneInput("+7 999 123"), "+7 (999) 123");
  assert.equal(formatPhoneInput("9991234567"), "+7 (999) 123-45-67");
  assert.equal(formatPhoneInput(""), "");
});
