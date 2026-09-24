import assert from "node:assert/strict";
import test from "node:test";
import { captureProcess, runProcess } from "./backup-process.mjs";

test("process capture preserves complete output and reports process failure", async () => {
  assert.equal(await captureProcess(process.execPath, ["-e", "process.stdout.write('complete listing')"]), "complete listing");
  await assert.rejects(captureProcess(process.execPath, ["-e", "process.exit(2)"]), /failed \(2\)/);
});

test("process capture rejects oversized output instead of accepting a truncated archive listing", async () => {
  await assert.rejects(captureProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(4_000_001))"]), /output exceeds the capture limit/);
});

for (const execute of [runProcess, captureProcess]) {
  test(`${execute.name} bounds subprocess lifetime even when SIGTERM is ignored`, async () => {
    const started = performance.now();
    await assert.rejects(execute(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { timeoutMs: 300 }), /time limit/);
    assert.ok(performance.now() - started < 5000);
    await assert.rejects(execute("/crm-test-command-does-not-exist", []), { code: "ENOENT" });
    await assert.rejects(execute(process.execPath, [], { timeoutMs: 0 }), /positive timer-safe integer/);
  });
}

test("process capture cannot accept success after a timeout or output-limit termination", async () => {
  await assert.rejects(captureProcess(process.execPath, ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"], { timeoutMs: 300 }), /time limit/);
  await assert.rejects(captureProcess(process.execPath, ["-e", "process.on('SIGTERM', () => {}); process.stdout.write('x'.repeat(4_000_001)); setInterval(() => {}, 1000)"]), /output exceeds/);
});
