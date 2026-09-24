import assert from "node:assert/strict";
import test from "node:test";
import { matchesRequestOrigin } from "./same-origin.ts";

test("origin validation accepts only explicitly configured origins including protocol and port", () => {
  const origins = ["https://crm.example.ru", "http://127.0.0.1:3000"];
  assert.equal(matchesRequestOrigin("https://crm.example.ru", origins), true);
  assert.equal(matchesRequestOrigin("http://127.0.0.1:3000", origins), true);
  assert.equal(matchesRequestOrigin("http://crm.example.ru", origins), false);
  assert.equal(matchesRequestOrigin("https://crm.example.ru:8443", origins), false);
});

test("missing, opaque, malformed and credential-bearing origins cannot bypass validation", () => {
  for (const origin of [null, "", "null", "not-a-url", "https://evil.example", "https://crm.example.ru/path", "https://user@crm.example.ru", "https://crm.example.ru#fragment", "https://crm.example.ru, https://evil.example"]) {
    assert.equal(matchesRequestOrigin(origin, ["https://crm.example.ru"]), false);
  }
});
