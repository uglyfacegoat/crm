import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";

const serviceUrl = new URL("../src/server/auth/service.ts", import.meta.url);
// Match Next's extensionless imports only for this module; production code stays unchanged.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl.href && specifier.startsWith("./")) {
      return nextResolve(new URL(`${specifier}.ts`, serviceUrl).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const consumeRateLimit = mock.fn();
const findCredential = mock.fn();
const verifyPassword = mock.fn();
const recordFailedLogin = mock.fn();
const createSession = mock.fn();
const dummyHash = "dummy-password-hash-for-service-test";
mock.module("server-only", { namedExports: {} });
mock.module(new URL("../src/server/auth/config.ts", import.meta.url), {
  namedExports: { getThrottleSecret: () => "test-only-throttle-secret-at-least-32-characters" },
});
mock.module(new URL("../src/server/auth/password.ts", import.meta.url), {
  namedExports: { DUMMY_PASSWORD_HASH: dummyHash, verifyPassword },
});
mock.module(new URL("../src/server/auth/repository.ts", import.meta.url), {
  namedExports: { consumeRateLimit, findCredential, recordFailedLogin, createSession, findSessionByTokenHash: mock.fn(), revokeSession: mock.fn() },
});
const { authenticateMember } = await import(serviceUrl.href);

const input = { identity: "member@example.invalid", password: "test-password", remember: false, clientAddress: "192.0.2.1" };
const credential = {
  organization_id: "7dc76962-e809-4c83-8faa-6906176a180a",
  member_id: "ab84b65b-73d5-4d26-a548-72a33e246e80",
  password_hash: "stored-hash",
  failed_login_attempts: 0,
  locked_until: null,
  active: true,
};

test("password authentication enforces the throttle before expensive work", async (t) => {
  t.beforeEach(() => {
    for (const fn of [consumeRateLimit, findCredential, verifyPassword, recordFailedLogin, createSession]) fn.mock.resetCalls();
    consumeRateLimit.mock.mockImplementation(async () => true);
    findCredential.mock.mockImplementation(async () => credential);
    verifyPassword.mock.mockImplementation(async () => true);
    recordFailedLogin.mock.mockImplementation(async () => {});
    createSession.mock.mockImplementation(async () => "session-id");
  });
  for (const deniedLimit of [10, 50]) {
    await t.test(`denied ${deniedLimit}-attempt bucket skips credential lookup, scrypt and session writes`, async () => {
      consumeRateLimit.mock.mockImplementation(async (_buckets, limit) => limit !== deniedLimit);
      assert.deepEqual(await authenticateMember(input), { ok: false, reason: "rate_limited" });
      assert.deepEqual(consumeRateLimit.mock.calls.map((call) => call.arguments.slice(1)), [[10, 15], [50, 15]]);
      for (const fn of [findCredential, verifyPassword, recordFailedLogin, createSession]) assert.equal(fn.mock.callCount(), 0);
    });
  }
  await t.test("invalid input never reaches the throttle or password verifier", async () => {
    assert.deepEqual(await authenticateMember({ ...input, password: "" }), { ok: false, reason: "invalid_credentials" });
    assert.equal(consumeRateLimit.mock.callCount(), 0);
    assert.equal(verifyPassword.mock.callCount(), 0);
  });
  await t.test("unknown identity still performs dummy password verification when allowed", async () => {
    findCredential.mock.mockImplementation(async () => null);
    verifyPassword.mock.mockImplementation(async () => false);
    assert.deepEqual(await authenticateMember({ ...input, clientAddress: null }), { ok: false, reason: "invalid_credentials" });
    assert.equal(consumeRateLimit.mock.callCount(), 1);
    assert.deepEqual(verifyPassword.mock.calls[0].arguments, [input.password, dummyHash]);
    assert.equal(recordFailedLogin.mock.callCount(), 0);
    assert.equal(createSession.mock.callCount(), 0);
  });
  await t.test("allowed successful login creates a hashed session token", async () => {
    const before = Date.now();
    const result = await authenticateMember(input);
    assert.equal(result.ok, true);
    assert.equal(verifyPassword.mock.callCount(), 1);
    assert.equal(createSession.mock.callCount(), 1);
    const session = createSession.mock.calls[0].arguments[0];
    assert.match(session.tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(session.tokenHash, result.session.token);
    assert.equal(session.credential, credential);
    assert.ok(result.session.expiresAt.getTime() >= before + 12 * 60 * 60 * 1000);
  });
  await t.test("incorrect password records failure without creating a session", async () => {
    verifyPassword.mock.mockImplementation(async () => false);
    assert.deepEqual(await authenticateMember(input), { ok: false, reason: "invalid_credentials" });
    assert.equal(recordFailedLogin.mock.callCount(), 1);
    assert.equal(createSession.mock.callCount(), 0);
  });
  await t.test("locked and inactive members cannot obtain sessions", async () => {
    for (const member of [{ ...credential, active: false }, { ...credential, locked_until: new Date(Date.now() + 60_000) }]) {
      findCredential.mock.mockImplementation(async () => member);
      assert.equal((await authenticateMember(input)).ok, false);
    }
    assert.equal(createSession.mock.callCount(), 0);
  });
  await t.test("throttle failures propagate instead of permitting login", async () => {
    const failure = new Error("Throttle database unavailable");
    consumeRateLimit.mock.mockImplementation(async () => { throw failure; });
    await assert.rejects(authenticateMember(input), (error) => error === failure);
    assert.equal(findCredential.mock.callCount(), 0);
    assert.equal(verifyPassword.mock.callCount(), 0);
    assert.equal(createSession.mock.callCount(), 0);
  });
  t.after(() => { mock.restoreAll(); hooks.deregister(); });
});
