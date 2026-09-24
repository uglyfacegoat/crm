import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock, test } from "node:test";
import postgres from "postgres";

const databaseUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (!databaseUrl) throw new Error("An isolated PostgreSQL test URL is required.");
const sourceRoot = new URL("../src/", import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.startsWith(sourceRoot.href) && specifier.startsWith("@/")) {
      return nextResolve(new URL(`${specifier.slice(2)}${/\.(ts|mjs)$/.test(specifier) ? "" : ".ts"}`, sourceRoot).href, context);
    }
    return nextResolve(specifier, context);
  },
});
let selectedPool;
mock.module("server-only", { namedExports: {} });
mock.module(new URL("server/database.ts", sourceRoot), { namedExports: { getDatabase: () => selectedPool } });
const { FileProcessingBusyError, withFileProcessingSlot } = await import("../src/server/file-scan/processing-slots.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("file-processing permits are shared across database pools and released on success or failure", async (t) => {
  const firstPool = postgres(databaseUrl, { max: 3 });
  const secondPool = postgres(databaseUrl, { max: 3 });
  t.after(async () => { mock.restoreAll(); hooks.deregister(); await firstPool.end(); await secondPool.end(); });

  const firstStarted = deferred();
  const secondStarted = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  selectedPool = firstPool;
  const first = withFileProcessingSlot(async () => {
    firstStarted.resolve();
    await releaseFirst.promise;
    return "first";
  });
  await firstStarted.promise;
  selectedPool = secondPool;
  const second = withFileProcessingSlot(async () => {
    secondStarted.resolve();
    await releaseSecond.promise;
    return "second";
  });
  await secondStarted.promise;

  selectedPool = firstPool;
  await assert.rejects(withFileProcessingSlot(async () => "unexpected"), FileProcessingBusyError);
  releaseFirst.resolve();
  assert.equal(await first, "first");
  await assert.rejects(withFileProcessingSlot(async () => { throw new Error("work failed"); }), /work failed/);
  assert.equal(await withFileProcessingSlot(async () => "reused"), "reused");
  releaseSecond.resolve();
  assert.equal(await second, "second");
});
