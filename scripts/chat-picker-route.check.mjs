import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { AuthorizationError } from "../src/server/auth/permissions.ts";

const root = new URL("../src/", import.meta.url);
const routeUrl = new URL("../src/app/api/v1/chat/entities/route.ts", import.meta.url);
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL === routeUrl.href && specifier.startsWith("@/")) {
    return nextResolve(new URL(`${specifier.slice(2)}.ts`, root).href, context);
  }
  return nextResolve(specifier, context);
} });
const member = { organizationId: "d81478c4-9807-44b4-befb-5819bbfbad22", memberId: "b8b990ca-763c-4d7e-a2c3-e4135d481d55", role: "admin", permissionOverrides: {} };
const getCurrentSession = mock.fn(async () => member);
const consumeRequestLimit = mock.fn(async () => ({ allowed: true, retryAfterSeconds: 60 }));
const searchChatEntityOptions = mock.fn(async () => [{ id: "older-record", type: "client", title: "Needle customer" }]);
mock.module(new URL("server/auth/config.ts", root), { namedExports: { getAuthMode: () => "required" } });
mock.module(new URL("server/auth/session.ts", root), { namedExports: { getCurrentSession } });
mock.module(new URL("server/request-limits/repository.ts", root), { namedExports: { consumeRequestLimit } });
mock.module(new URL("server/chat/repository.ts", root), { namedExports: { searchChatEntityOptions } });
const { GET } = await import(routeUrl.href);
const request = (query) => new Request(`http://localhost/api/v1/chat/entities?${query}`);

test("chat picker requires a session, bounded query, and member/company budget", async (t) => {
  t.after(() => { mock.restoreAll(); hooks.deregister(); });
  t.beforeEach(() => {
    for (const fn of [getCurrentSession, consumeRequestLimit, searchChatEntityOptions]) fn.mock.resetCalls();
    getCurrentSession.mock.mockImplementation(async () => member);
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: true, retryAfterSeconds: 60 }));
    searchChatEntityOptions.mock.mockImplementation(async () => [{ id: "older-record", type: "client", title: "Needle customer" }]);
  });

  await t.test("unauthenticated and malformed requests never search", async () => {
    getCurrentSession.mock.mockImplementation(async () => null);
    assert.equal((await GET(request("type=client&q=Needle"))).status, 401);
    getCurrentSession.mock.mockImplementation(async () => member);
    for (const query of ["type=client&q=x", "type=unknown&q=Needle", `type=client&q=${"x".repeat(81)}`]) {
      assert.equal((await GET(request(query))).status, 400);
    }
    assert.equal(consumeRequestLimit.mock.callCount(), 0);
    assert.equal(searchChatEntityOptions.mock.callCount(), 0);
  });
  await t.test("budget rejection precedes database search", async () => {
    consumeRequestLimit.mock.mockImplementation(async () => ({ allowed: false, retryAfterSeconds: 19 }));
    const response = await GET(request("type=client&q=Needle"));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "19");
    assert.equal(searchChatEntityOptions.mock.callCount(), 0);
  });
  await t.test("authorized search returns only the repository result", async () => {
    const response = await GET(request("type=client&q=Needle"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual((await response.json()).data.map((item) => item.id), ["older-record"]);
    assert.deepEqual(searchChatEntityOptions.mock.calls[0].arguments, [member, "client", "Needle"]);
  });
  await t.test("forbidden entity type does not return data", async () => {
    searchChatEntityOptions.mock.mockImplementation(async () => { throw new AuthorizationError(); });
    assert.equal((await GET(request("type=client&q=Needle"))).status, 403);
  });
});
