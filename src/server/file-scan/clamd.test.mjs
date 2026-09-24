import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { zipSync } from "fflate";
import { checkScannerAvailability, FileScanRejectedError, FileScanUnavailableError, scanFileBuffer } from "./clamd.mjs";

async function withScanner(reply, run) {
  let received = Buffer.alloc(0);
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (received.subarray(0, 10).equals(Buffer.from("zINSTREAM\0"))) {
        if (received.length < 18) return;
        const size = received.readUInt32BE(10);
        if (received.length < 18 + size) return;
      } else if (!received.equals(Buffer.from("zVERSIONCOMMANDS\0"))) return;
      if (reply !== null) socket.end(`${reply}\0`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const environment = { CRM_FILE_SCAN_MODE: "required", CRM_CLAMD_HOST: "127.0.0.1", CRM_CLAMD_PORT: String(address.port), CRM_CLAMD_TIMEOUT_MS: "1000" };
  try { await run(environment, () => received); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => server.close(resolve)); }
}

test("required scan sends exact INSTREAM bytes and accepts a clean response", { timeout: 3000 }, async () => {
  const file = Buffer.from("example file");
  await withScanner("stream: OK", async (environment, received) => {
    await scanFileBuffer(file, environment);
    assert.equal(received().subarray(0, 10).toString(), "zINSTREAM\0");
    assert.equal(received().readUInt32BE(10), file.length);
    assert.deepEqual(received().subarray(14, 14 + file.length), file);
    assert.equal(received().readUInt32BE(14 + file.length), 0);
  });
});

test("required scan rejects a detected file and fails closed on scanner errors", { timeout: 7000 }, async () => {
  for (const [reply, errorType] of [
    ["stream: Eicar-Test-Signature FOUND", FileScanRejectedError],
    ["stream: Access denied ERROR", FileScanUnavailableError],
    ["unexpected", FileScanUnavailableError],
    [null, FileScanUnavailableError],
  ]) {
    await withScanner(reply, async (environment) => {
      await assert.rejects(scanFileBuffer(Buffer.from("file"), environment), errorType);
    });
  }
});

test("required scan rejects an oversized expanded ZIP before sending it to a scanner that would say OK", async () => {
  const archive = Buffer.from(zipSync({ "[Content_Types].xml": Buffer.from("<Types/>"), "word/document.xml": Buffer.alloc(26 * 1024 * 1024, 65) }));
  await withScanner("stream: OK", async (environment, received) => {
    await assert.rejects(scanFileBuffer(archive, environment), FileScanRejectedError);
    assert.equal(received().length, 0);
  });
});

test("availability requires INSTREAM support and configuration cannot silently disable a scan", { timeout: 3000 }, async () => {
  await withScanner("ClamAV 1.5.4/123/test| COMMANDS: SCAN INSTREAM PING", async (environment, received) => {
    await checkScannerAvailability(environment);
    assert.deepEqual(received(), Buffer.from("zVERSIONCOMMANDS\0"));
  });
  await withScanner("ClamAV 1.5.4/123/test| COMMANDS: SCAN PING", async (environment) => {
    await assert.rejects(checkScannerAvailability(environment), FileScanUnavailableError);
  });
  await assert.rejects(scanFileBuffer(Buffer.from("file"), { CRM_FILE_SCAN_MODE: "required" }), /CRM_CLAMD/);
  await assert.rejects(scanFileBuffer(Buffer.from("file"), { CRM_FILE_SCAN_MODE: "misspelled" }), /CRM_FILE_SCAN_MODE/);
  await scanFileBuffer(Buffer.from("file"), { CRM_FILE_SCAN_MODE: "off" });
});
