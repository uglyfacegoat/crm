import assert from "node:assert/strict";
import test from "node:test";
import { matchesRequestOrigin } from "./same-origin.ts";

test("same-origin validation uses the public Host header inside a container", () => {
  assert.equal(matchesRequestOrigin({
    origin: "http://127.0.0.1:3000",
    requestUrl: "http://0.0.0.0:3000/api/v1/documents/export",
    host: "127.0.0.1:3000",
    forwardedHost: null,
    forwardedProtocol: null,
  }), true);
});

test("same-origin validation honors forwarded HTTPS and rejects another site", () => {
  const request = {
    requestUrl: "http://crm:3000/api/v1/documents/export",
    host: null,
    forwardedHost: "crm.example.ru",
    forwardedProtocol: "https",
  };
  assert.equal(matchesRequestOrigin({ ...request, origin: "https://crm.example.ru" }), true);
  assert.equal(matchesRequestOrigin({ ...request, origin: "https://evil.example" }), false);
  assert.equal(matchesRequestOrigin({ ...request, origin: "not-a-url" }), false);
});
