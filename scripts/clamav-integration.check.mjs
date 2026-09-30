import assert from "node:assert/strict";
import { checkScannerAvailability, FileScanRejectedError, scanFileBuffer } from "../src/server/file-scan/clamd.mjs";
import { zipSync } from "fflate";

assert.equal(process.env.CRM_FILE_SCAN_MODE, "required", "Run with CRM_FILE_SCAN_MODE=required against an isolated ClamAV daemon.");
await checkScannerAvailability();
await scanFileBuffer(Buffer.from("clean CRM scanner test"));
// EICAR's harmless standard test string confirms the daemon has a usable signature database.
const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
await assert.rejects(scanFileBuffer(eicar), FileScanRejectedError);
const office = Buffer.from(zipSync({
  "[Content_Types].xml": Buffer.from("<Types/>"),
  "word/eicar.com": eicar,
}));
await assert.rejects(scanFileBuffer(office), FileScanRejectedError);
const expandedArchive = Buffer.from(zipSync({
  "[Content_Types].xml": Buffer.from("<Types/>"),
  "word/document.xml": Buffer.alloc(26 * 1024 * 1024, 65),
}));
assert.ok(expandedArchive.length < 100_000);
await assert.rejects(scanFileBuffer(expandedArchive), FileScanRejectedError);
console.log("ClamAV accepted a clean file; EICAR and an oversized expanded Office ZIP were rejected.");
