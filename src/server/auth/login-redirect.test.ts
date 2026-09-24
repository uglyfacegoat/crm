import assert from "node:assert/strict";
import test from "node:test";
import { safeLoginRedirect } from "./login-redirect.ts";

test("login preserves internal destinations with query strings and fragments", () => {
  for (const path of ["/", "/tasks", "/orders?status=new#list", "/clients?q=https%3A%2F%2Fexample.com"]) {
    assert.equal(safeLoginRedirect(path), path);
  }
});

test("login rejects external and browser-normalized external destinations", () => {
  for (const value of [null, undefined, ["/tasks"], "", "https://untrusted.invalid", "//untrusted.invalid", "/\\untrusted.invalid", "/\t/untrusted.invalid", "/\n/untrusted.invalid", "/\r/untrusted.invalid", "/\0tasks", "javascript:alert(1)"]) {
    assert.equal(safeLoginRedirect(value), "/");
  }
});
