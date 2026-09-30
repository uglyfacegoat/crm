import assert from "node:assert/strict";
import test from "node:test";
import { getTrustedClientAddress } from "./client-address.ts";

test("untrusted forwarding headers never provide a client address", () => {
  const headers = new Headers({ "x-real-ip": "203.0.113.1", "x-forwarded-for": "198.51.100.2" });
  assert.equal(getTrustedClientAddress(headers, false), null);
});

test("trusted ingress accepts only a single valid IP in its overwritten header", () => {
  for (const address of ["203.0.113.1", "2001:db8::1"]) {
    assert.equal(getTrustedClientAddress(new Headers({ "x-real-ip": address }), true), address);
  }
  for (const address of ["example.com", "203.0.113.1, 198.51.100.2", "203.0.113.1:80", "unknown", ""]) {
    assert.equal(getTrustedClientAddress(new Headers({ "x-real-ip": address }), true), null);
  }
  assert.equal(getTrustedClientAddress(new Headers({ "x-forwarded-for": "203.0.113.1" }), true), null);
});
