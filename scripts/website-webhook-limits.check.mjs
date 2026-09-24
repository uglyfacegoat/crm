import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import { getTrustedClientAddress } from "../src/server/auth/client-address.ts";

const sourceRoot = new URL("../src/", import.meta.url);
const routeUrl = new URL("../src/app/api/v1/webhooks/website-leads/route.ts", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === routeUrl.href && specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const consumeRateLimit = mock.fn(async () => true);
const ingestWebsiteLead = mock.fn(async () => ({ leadId: "d81478c4-9807-44b4-befb-5819bbfbad22", duplicate: false }));
const IncomingLeadNotFoundError = class extends Error {};
const IncomingLeadRateLimitError = class extends Error {};
mock.module(new URL("server/auth/repository.ts", sourceRoot), { namedExports: { consumeRateLimit } });
mock.module(new URL("server/auth/request.ts", sourceRoot), { namedExports: {
  getClientAddress: (headers) => getTrustedClientAddress(headers, process.env.CRM_TRUST_PROXY === "true"),
} });
mock.module(new URL("server/incoming-leads/repository.ts", sourceRoot), { namedExports: {
  IncomingLeadNotFoundError, IncomingLeadRateLimitError, ingestWebsiteLead,
} });

const { POST } = await import(routeUrl.href);
const previousSecret = process.env.CRM_WEBSITE_WEBHOOK_SECRET;
const previousTrustProxy = process.env.CRM_TRUST_PROXY;
const secret = "test-webhook-secret-with-at-least-32-characters";
process.env.CRM_WEBSITE_WEBHOOK_SECRET = secret;

function request({ authorization = `Bearer ${secret}`, headers = {}, body = {} } = {}) {
  return new Request("http://localhost/api/v1/webhooks/website-leads", {
    method: "POST",
    headers: { authorization, "content-type": "application/json", ...headers },
    body: JSON.stringify({
      websiteId: "d81478c4-9807-44b4-befb-5819bbfbad22",
      eventId: "event-1",
      phone: "+79990000000",
      ...body,
    }),
  });
}

test("website webhook limits do not trust caller-controlled IP headers and deny before payload work", async (t) => {
  t.after(() => {
    if (previousSecret === undefined) delete process.env.CRM_WEBSITE_WEBHOOK_SECRET;
    else process.env.CRM_WEBSITE_WEBHOOK_SECRET = previousSecret;
    if (previousTrustProxy === undefined) delete process.env.CRM_TRUST_PROXY;
    else process.env.CRM_TRUST_PROXY = previousTrustProxy;
    mock.restoreAll();
    hooks.deregister();
  });
  t.beforeEach(() => {
    consumeRateLimit.mock.resetCalls();
    consumeRateLimit.mock.mockImplementation(async () => true);
    ingestWebsiteLead.mock.resetCalls();
    process.env.CRM_TRUST_PROXY = "false";
  });

  await t.test("untrusted forwarded IP cannot multiply buckets", async () => {
    for (const ip of ["203.0.113.1", "198.51.100.2"]) {
      assert.equal((await POST(request({ headers: { "x-real-ip": ip } }))).status, 201);
    }
    assert.equal(consumeRateLimit.mock.callCount(), 2);
    assert.equal(consumeRateLimit.mock.calls[0].arguments[0][0], consumeRateLimit.mock.calls[1].arguments[0][0]);
  });

  await t.test("trusted ingress uses a separate IP bucket as well as the global bucket", async () => {
    process.env.CRM_TRUST_PROXY = "true";
    assert.equal((await POST(request({ headers: { "x-real-ip": "203.0.113.1" } }))).status, 201);
    assert.equal(consumeRateLimit.mock.callCount(), 2);
    assert.equal(consumeRateLimit.mock.calls[0].arguments[1], 600);
    assert.equal(consumeRateLimit.mock.calls[1].arguments[1], 120);
    assert.notEqual(consumeRateLimit.mock.calls[0].arguments[0][0], consumeRateLimit.mock.calls[1].arguments[0][0]);
  });

  await t.test("blocked traffic is rejected before authorization and ingestion", async () => {
    consumeRateLimit.mock.mockImplementation(async () => false);
    const response = await POST(request({ authorization: "Bearer wrong", body: { eventId: "invalid id" } }));
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(ingestWebsiteLead.mock.callCount(), 0);
  });
});
