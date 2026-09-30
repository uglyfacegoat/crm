import assert from "node:assert/strict";
import { test } from "node:test";
import { hashEmailOtpCode, matchesEmailOtpCode } from "./email-otp-code.mjs";

test("email login codes are scoped to one challenge and compared as hashes", () => {
  const secret = "test-secret-that-is-longer-than-thirty-two-characters";
  const first = hashEmailOtpCode(secret, "challenge-a", "1234567");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, hashEmailOtpCode(secret, "challenge-b", "1234567"));
  assert.equal(matchesEmailOtpCode(first, hashEmailOtpCode(secret, "challenge-a", "1234567")), true);
  assert.equal(matchesEmailOtpCode(first, hashEmailOtpCode(secret, "challenge-a", "1234568")), false);
  assert.equal(matchesEmailOtpCode(first, "not-a-hash"), false);
});
